// lib/voice/speech.ts — enveloppe de la reconnaissance vocale du navigateur (Web Speech API, fr-FR),
// de la synthèse vocale et du Wake Lock. Ne fonctionne que dans un navigateur ; aucun import de React.
// Version « en ligne » : le navigateur envoie l'audio à son fournisseur (Google pour Chrome).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EngineMode = 'auto' | 'cloud' | 'local';
export type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';
export interface LocalSupport { api: boolean; availability: LocalAvailability; phrases: boolean }
export interface PhraseHint { phrase: string; boost: number }

/** Chrome 139+ : reconnaissance sur l'appareil (processLocally). Vérifie ce que CE navigateur sait faire en français. */
export async function checkLocalSupport(): Promise<LocalSupport> {
  const Ctor = getCtor();
  if (!Ctor) return { api: false, availability: 'unavailable', phrases: false };
  const phrases = typeof window !== 'undefined' && 'SpeechRecognitionPhrase' in (window as any) && 'phrases' in (Ctor.prototype || {});
  if (typeof Ctor.available !== 'function') return { api: false, availability: 'unknown', phrases };
  try {
    const a = await Ctor.available({ langs: ['fr-FR'], processLocally: true });
    const v = String(a) as LocalAvailability;
    return { api: true, availability: (['available', 'downloadable', 'downloading', 'unavailable'] as string[]).includes(v) ? v : 'unknown', phrases };
  } catch { return { api: true, availability: 'unknown', phrases }; }
}

/** Télécharge le modèle français pour le mode hors ligne (réseau nécessaire, à lancer depuis un bouton). */
export async function installLocal(): Promise<boolean> {
  const Ctor = getCtor();
  if (!Ctor || typeof Ctor.install !== 'function') return false;
  try { return !!(await Ctor.install({ langs: ['fr-FR'], processLocally: true })); } catch { return false; }
}

export type EngineState = 'off' | 'starting' | 'listening' | 'speaking' | 'error';
export type EngineErrorKind = 'unsupported' | 'not-allowed' | 'network' | 'no-mic' | 'no-local' | 'other';

export interface VoiceEngineHandlers {
  /** Une phrase finale : les alternatives, la plus probable d'abord. */
  onResult: (alternatives: string[], meta?: { key: string }) => void;
  /** Texte provisoire (la phrase n'est pas finie) : permet de répondre sans attendre la fin du silence. */
  onInterim?: (alternatives: string[], meta: { key: string }) => void;
  onState: (s: EngineState) => void;
  /** Erreur fatale : le mode vocal doit être coupé (message à afficher). */
  onFatal: (kind: EngineErrorKind, message: string) => void;
  /** Moteur réellement utilisé : en ligne (cloud) ou sur l'appareil. */
  onEngine?: (e: 'cloud' | 'local') => void;
  /** Événements bruts du moteur (démarrage, son détecté, résultat, erreur…) : pour comprendre pourquoi une phrase n'arrive pas. */
  onDebug?: (line: string) => void;
  /** Réglage choisi par l'utilisateur (relu à chaque ouverture de l'écoute). */
  getMode?: () => EngineMode;
  /** Mots à favoriser (prénoms, vocabulaire) quand le navigateur sait le faire. */
  getPhrases?: () => PhraseHint[];
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
  'no-local': "Hors ligne : le français n'est pas installé sur l'appareil. Connectez-vous et touchez « Préparer le mode hors ligne ».",
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
  private sessionSeq = 0;
  private delivered = new Set<string>();   // finals déjà remis (certains moteurs répètent le dernier résultat)
  private forceLocal = false;   // le réseau a lâché : on bascule sur la reconnaissance de l'appareil

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

  /** Relit le mode / le réseau et rouvre l'écoute (ex. : le réseau vient de partir ou de revenir). */
  refresh(): void {
    if (!this.active) return;
    this.forceLocal = false;
    this.closeRecognition();
    if (!this.speaking) this.openRecognition();
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

    const mode: EngineMode = this.h.getMode?.() ?? 'auto';
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const local = mode === 'local' || (mode === 'auto' && (offline || this.forceLocal));
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    if (local) { try { rec.processLocally = true; } catch { /* non géré */ } }
    this.h.onEngine?.(local ? 'local' : 'cloud');
    // Liste de mots favorisés (prénoms, commandes) : seulement si le navigateur la gère.
    try {
      const hints = this.h.getPhrases?.() ?? [];
      const PhraseCtor = (window as any).SpeechRecognitionPhrase;
      if (hints.length && PhraseCtor && 'phrases' in rec) rec.phrases = hints.map((x) => new PhraseCtor(x.phrase, x.boost));
    } catch { /* ignoré : la reconnaissance marche sans */ }
    rec.continuous = true;
    rec.interimResults = true;
    const session = ++this.sessionSeq;
    rec.maxAlternatives = 5;

    rec.onstart = () => { if (this.rec === rec) this.setState(this.speaking ? 'speaking' : 'listening'); };
    const dbg = (l: string) => { try { this.h.onDebug?.(l); } catch { /* ignoré */ } };
    rec.onaudiostart = () => dbg('micro ouvert');
    rec.onsoundstart = () => dbg('son détecté');
    rec.onspeechstart = () => dbg('voix détectée');
    rec.onspeechend = () => dbg('fin de voix');
    rec.onsoundend = () => dbg('fin du son');
    rec.onnomatch = () => dbg('voix entendue mais rien compris (nomatch)');
    rec.onresult = (e: any) => {
      if (this.speaking) { dbg('résultat ignoré : l’appli parle'); return; } // écho : on ignore ce qui est entendu pendant la synthèse
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts: string[] = [];
        for (let k = 0; k < r.length; k++) { const tr = String(r[k].transcript || '').trim(); if (tr) alts.push(tr); }
        if (!alts.length) continue;
        const meta = { key: `${session}:${i}` };
        dbg(`${r.isFinal ? 'FINAL' : 'provisoire'} #${i} : « ${alts[0]} »`);
        if (r.isFinal) {
          if (this.delivered.has(meta.key)) continue;
          this.delivered.add(meta.key);
          if (this.delivered.size > 200) this.delivered.clear();
          this.recentStarts = []; this.h.onResult(alts, meta);
        }
        else this.h.onInterim?.(alts, meta);
      }
    };
    rec.onerror = (e: any) => {
      const code = String(e?.error || '');
      dbg(`erreur : ${code}`);
      if (code === 'no-speech' || code === 'aborted') return; // silence ou arrêt volontaire : on relance sans bruit
      if (code === 'not-allowed' || code === 'service-not-allowed') { this.fatal('not-allowed'); return; }
      if (code === 'language-not-supported') { this.fatal(local ? 'no-local' : 'other'); return; }
      if (code === 'network') {
        // Réseau perdu : on tente la reconnaissance sur l'appareil avant d'abandonner.
        if (!local && mode !== 'cloud' && !this.forceLocal) { this.forceLocal = true; return; }
        this.fatal(local ? 'no-local' : 'network'); return;
      }
      if (code === 'audio-capture') { this.fatal('no-mic'); return; }
      // autre erreur : on laisse onend relancer
    };
    rec.onend = () => {
      dbg('écoute terminée (relance automatique)');
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
