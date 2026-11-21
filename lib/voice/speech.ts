// lib/voice/speech.ts — enveloppe de la reconnaissance vocale du navigateur (Web Speech API, fr-FR),
// de la synthèse vocale et du Wake Lock. Ne fonctionne que dans un navigateur ; aucun import de React.
// Version « en ligne » : le navigateur envoie l'audio à son fournisseur (Google pour Chrome).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EngineState = 'off' | 'starting' | 'listening' | 'speaking' | 'error';
export type EngineErrorKind = 'unsupported' | 'not-allowed' | 'network' | 'no-mic' | 'other';

export interface VoiceEngineHandlers {
  /** Une phrase finale : les alternatives, la plus probable d'abord. */
  onResult: (alternatives: string[]) => void;
  onState: (s: EngineState) => void;
  /** Erreur fatale : le mode vocal doit être coupé (message à afficher). */
  onFatal: (kind: EngineErrorKind, message: string) => void;
}

const getCtor = (): any => {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const isRecognitionSupported = (): boolean => !!getCtor();
export const isSynthesisSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

const ERR_MSG: Record<EngineErrorKind, string> = {
  unsupported: "Ce navigateur ne gère pas la reconnaissance vocale (utiliser Chrome).",
  'not-allowed': "Micro refusé. Autorisez le micro pour ce site dans le navigateur.",
  network: "Pas de réseau pour la reconnaissance vocale. Les boutons restent utilisables.",
  'no-mic': "Aucun micro détecté.",
  other: "Erreur de reconnaissance vocale.",
};

export class VoiceEngine {
  private rec: any = null;
  private active = false;          // l'interrupteur est sur « actif »
  private speaking = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private recentStarts: number[] = [];
  private speakId = 0;
  private state: EngineState = 'off';

  constructor(private h: VoiceEngineHandlers) {}

  // ───────── écoute
  start(): boolean {
    const Ctor = getCtor();
    if (!Ctor) { this.fatal('unsupported'); return false; }
    if (this.active) return true;
    this.active = true;
    this.recentStarts = [];
    this.setState('starting');
    this.openRecognition();
    return true;
  }

  stop(): void {
    this.active = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.closeRecognition();
    this.cancelSpeech();
    this.setState('off');
  }

  private setState(s: EngineState) {
    if (this.state === s) return;
    this.state = s;
    this.h.onState(s);
  }

  private fatal(kind: EngineErrorKind) {
    const wasActive = this.active;
    this.active = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.closeRecognition();
    this.cancelSpeech();
    this.setState('error');
    if (wasActive || kind === 'unsupported') this.h.onFatal(kind, ERR_MSG[kind]);
  }

  private openRecognition() {
    if (!this.active || this.speaking || this.rec) return;
    const Ctor = getCtor();
    if (!Ctor) return;
    // Garde-fou : si la reconnaissance se relance en boucle sans rien entendre (bips sur Android), on ralentit.
    const now = Date.now();
    this.recentStarts = this.recentStarts.filter((t) => now - t < 5000);
    this.recentStarts.push(now);
    const delay = this.recentStarts.length > 6 ? 2000 : 250;

    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 5;

    rec.onstart = () => { if (this.rec === rec) this.setState(this.speaking ? 'speaking' : 'listening'); };
    rec.onresult = (e: any) => {
      if (this.speaking) return; // écho : on ignore ce qui est entendu pendant la synthèse
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const alts: string[] = [];
        for (let k = 0; k < r.length; k++) { const tr = String(r[k].transcript || '').trim(); if (tr) alts.push(tr); }
        if (alts.length) { this.recentStarts = []; this.h.onResult(alts); }
      }
    };
    rec.onerror = (e: any) => {
      const code = String(e?.error || '');
      if (code === 'no-speech' || code === 'aborted') return; // silence ou arrêt volontaire : on relance sans bruit
      if (code === 'not-allowed' || code === 'service-not-allowed') { this.fatal('not-allowed'); return; }
      if (code === 'network') { this.fatal('network'); return; }
      if (code === 'audio-capture') { this.fatal('no-mic'); return; }
      // autre erreur : on laisse onend relancer
    };
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      if (this.active && !this.speaking) {
        this.restartTimer = setTimeout(() => { this.restartTimer = null; this.openRecognition(); }, delay);
      }
    };
    this.rec = rec;
    try { rec.start(); } catch { this.rec = null; this.restartTimer = setTimeout(() => { this.restartTimer = null; this.openRecognition(); }, 500); }
  }

  private closeRecognition() {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    rec.onresult = null; rec.onerror = null; rec.onend = null; rec.onstart = null;
    try { rec.abort(); } catch { /* déjà arrêtée */ }
  }

  // ───────── synthèse vocale
  /** Dit une ou plusieurs phrases courtes. Annule ce qui était en cours. L'écoute est suspendue pendant la parole. */
  speak(phrases: string | string[]): void {
    if (!isSynthesisSupported()) return;
    const list = (Array.isArray(phrases) ? phrases : [phrases]).map((p) => p.trim()).filter(Boolean);
    if (!list.length) return;
    const synth = window.speechSynthesis;
    const id = ++this.speakId;
    synth.cancel(); // l'ancienne phrase se termine : son onend est ignoré (id périmé)
    this.beginSpeaking();
    const u = new SpeechSynthesisUtterance(list.join('. '));
    u.lang = 'fr-FR';
    u.rate = 1.2;
    const voice = synth.getVoices().find((v: { lang?: string }) => v.lang && v.lang.toLowerCase().startsWith('fr'));
    if (voice) u.voice = voice;
    const done = () => { if (id === this.speakId) this.endSpeaking(); };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  }

  cancelSpeech(): void {
    this.speakId++;
    if (isSynthesisSupported()) window.speechSynthesis.cancel();
    if (this.speaking) this.endSpeaking();
  }

  private beginSpeaking() {
    if (this.speaking) return;
    this.speaking = true;
    if (this.active) { this.closeRecognition(); this.setState('speaking'); }
  }

  private endSpeaking() {
    this.speaking = false;
    if (!this.active) return;
    this.setState('starting');
    // petit délai : laisse l'écho de la fin de phrase s'éteindre avant de rouvrir le micro
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.openRecognition(); }, 200);
  }
}

// ───────── Wake Lock : écran allumé tant que le mode vocal est actif
export interface WakeLockHandle { release: () => void }

export function holdWakeLock(): WakeLockHandle {
  let sentinel: any = null;
  let stopped = false;
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
  const request = async () => {
    if (stopped || !nav?.wakeLock) return;
    try { sentinel = await nav.wakeLock.request('screen'); } catch { sentinel = null; }
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void request(); };
  void request();
  document.addEventListener('visibilitychange', onVisible);
  return {
    release: () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      try { sentinel?.release?.(); } catch { /* ignoré */ }
      sentinel = null;
    },
  };
}
