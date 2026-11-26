'use client';
// components/VoiceControl.tsx — commande vocale de la saisie en direct (version en ligne, navigateur).
// Reçoit l'état du match et des fonctions d'action ; ne touche à rien d'autre dans l'application.
// Les boutons de l'écran restent l'interface de référence : ce composant ne fait que les « presser » à la voix.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceDialog, VoiceAction, VoiceView } from '../lib/voice/dialog';
import VoiceCalibration from './VoiceCalibration';
import { VoiceProfile, addAliasTo, emptyProfile, mergeProfiles, profileDelta, sanitizeProfile } from '../lib/voice/calibrate';
import { loadProfile, loadShared, saveProfile, shareEntries } from '../lib/voice/profileStore';
import { VoicePlayer, strip } from '../lib/voice/commands';
import { VoiceEngine, EngineState, EngineMode, LocalSupport, PhraseHint, checkLocalSupport, installLocal, holdWakeLock, isRecognitionSupported, isSynthesisSupported, WakeLockHandle } from '../lib/voice/speech';

export interface VoiceRosterPlayer { id: string; number: number; name: string }
export interface VoiceEventLike { id: string; actionType: string; playerId: string; period: number }

/** Adaptateurs fournis par TeamStatsApp (page.tsx). */
export interface VoiceActions {
  recordEvent: (action: string, playerId: string, points?: number) => void;
  bumpScore: (side: 'home' | 'away', delta: number) => void;
  applySubstitution: (outIds: string[], inIds: string[]) => void;
  submitFreeThrows: (playerId: string, made: number, attempts: number) => void;
  deleteEvent: (eventId: string) => void;
  setClockRunning: (running: boolean) => void;
  subPanel: (op: 'open' | 'close' | 'validate') => void;
  /** Retour visuel : sélectionne la joueuse et allume la touche (action = libellé d'événement, ou « CHRONO »). */
  highlight: (playerId: string | null, action: string) => void;
  selectPlayer: (playerId: string | null) => void;
  /** Affiche les lancers francs en cours dans le panneau de l'écran. */
  ftView: (playerId: string | null, attempts: [boolean | null, boolean | null, boolean | null]) => void;
}

interface Props {
  /** Compte connecté : le profil vocal (prénoms, calibrage) est enregistré sur ce compte. */
  userId: string;
  roster: VoiceRosterPlayer[];
  onCourtPlayerIds: string[];
  events: VoiceEventLike[];
  scoreHome: number;
  scoreAway: number;
  period: number;
  clockRunning: boolean;
  selectedPlayerId: string | null;
  subPanel: { open: boolean; outCount: number; inCount: number };
  actions: VoiceActions;
  /** Didacticiel : dernière réponse vocale, et état de l'interrupteur. */
  onVoiceResult?: (r: { say: string; actions: number; at: number }) => void;
  onEnabledChange?: (enabled: boolean) => void;
  /** Bouton à gauche de « Calibrer » : Didacticiel (aucun match ouvert), Nouveau (match ouvert) ou Quitter le didacticiel. */
  tutorial?: { label: string; kind: 'demo' | 'new' | 'quit'; onClick: () => void; title?: string };
}

const ALIAS_KEY = 'teamstats.voice.aliases.v1';
const MODE_KEY = 'teamstats.voice.mode.v1';
const PHRASES_KEY = 'teamstats.voice.phrases.v1';
const BARGE_KEY = 'teamstats.voice.casque.v1';
const VOCAB = ['lancer franc', 'lancers francs', 'interception', 'rebond offensif', 'rebond défensif', 'passe décisive', 'perte de balle', 'balle perdue', 'faute technique', 'faute antisportive', 'faute disqualifiante', 'faute subie', 'remplacement', 'sur le terrain on a', 'démarrer chrono', 'arrêt chrono', 'démarrer le match', 'temps mort', 'annule la dernière commande', 'deux points', 'trois points', 'adversaire', 'contrée', 'sélectionne'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Prénom prononcé : premier mot du nom ; vide si ce n'est pas un vrai prénom (« 5 », « J5 »…). */
const firstNameOf = (name: string): string => {
  const w = (name || '').trim().split(/\s+/)[0] || '';
  const k = strip(w);
  if (!k || /^\d+$/.test(k) || /^j\d+$/.test(k) || k.length < 3) return '';
  return w;
};

const readAliases = (): Record<string, string[]> => {
  try { const raw = window.localStorage.getItem(ALIAS_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};
const writeAliases = (v: Record<string, string[]>) => {
  try { window.localStorage.setItem(ALIAS_KEY, JSON.stringify(v)); } catch { /* stockage indisponible : ignoré */ }
};

const STATE_LABEL: Record<EngineState, string> = {
  off: 'Coupé', starting: 'Démarrage…', listening: 'À l’écoute', speaking: 'Je parle…', error: 'Erreur',
};

export default function VoiceControl(props: Props) {
  const [enabled, setEnabled] = useState(false);
  const [engineState, setEngineState] = useState<EngineState>('off');
  const [dialogStatus, setDialogStatus] = useState('À l’écoute');
  const [message, setMessage] = useState<string | null>(null);
  const [heard, setHeard] = useState<string[]>([]);
  const [said, setSaid] = useState('');
  const [unknownHeard, setUnknownHeard] = useState('');
  const [saidKind, setSaidKind] = useState<'ok' | 'wait' | 'info' | 'error'>('info');
  const [diag, setDiag] = useState(false);
  const [bargeIn, setBargeIn] = useState(true);   // casque : écoute continue pendant que l'appli parle (par défaut)
  const bargeRef = useRef(true);
  bargeRef.current = bargeIn;
  const diagRef = useRef(false);
  const engineBuf = useRef<string[]>([]);
  const [usePhrases, setUsePhrases] = useState(false);   // liste de mots favorisés : désactivée par défaut (à essayer)
  const phrasesRef = useRef(false);
  phrasesRef.current = usePhrases;
  const [engineLog, setEngineLog] = useState<string[]>([]);
  const [journal, setJournal] = useState<Array<{ at: string; alts: string[]; said: string; kind: string }>>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [online, setOnline] = useState(true);
  const [showEngine, setShowEngine] = useState(false);
  const [engineMode, setEngineMode] = useState<EngineMode>('auto');
  const [activeEngine, setActiveEngine] = useState<'cloud' | 'local' | null>(null);
  const [localSupport, setLocalSupport] = useState<LocalSupport | null>(null);
  const [installing, setInstalling] = useState(false);
  const [profile, setProfile] = useState<VoiceProfile>(emptyProfile());
  const profileRef = useRef<VoiceProfile>(emptyProfile());
  const [profileSync, setProfileSync] = useState<'idle' | 'saved' | 'offline'>('idle');
  const [showCal, setShowCal] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shared, setShared] = useState<VoiceProfile>(emptyProfile());
  // Profil effectif = apprentissages communs du club + profil personnel (le personnel l'emporte).
  const effective = useMemo(() => mergeProfiles(shared, profile), [shared, profile]);
  const effectiveRef = useRef<VoiceProfile>(effective);
  effectiveRef.current = effective;
  const aliases = profile.aliases;

  // ───── Toujours lire l'état le plus récent depuis les rappels asynchrones de la reconnaissance
  const players: VoicePlayer[] = useMemo(
    () => props.roster.map((p) => {
      const first = firstNameOf(p.name);
      return { id: p.id, number: p.number, name: first, aliases: first ? effective.aliases[strip(first)] ?? [] : [] };
    }),
    [props.roster, effective],
  );
  const viewRef = useRef<VoiceView>({ players: [], onCourt: [], events: [], scoreHome: 0, scoreAway: 0, period: 1, clockRunning: false, subPanel: { open: false, outCount: 0, inCount: 0 } });
  viewRef.current = {
    players,
    onCourt: props.onCourtPlayerIds,
    events: props.events,
    scoreHome: props.scoreHome,
    scoreAway: props.scoreAway,
    period: props.period,
    clockRunning: props.clockRunning,
    wordFixes: effective.wordFixes,
    selectedPlayerId: props.selectedPlayerId,
    subPanel: props.subPanel,
  };
  const actionsRef = useRef<VoiceActions>(props.actions);
  actionsRef.current = props.actions;

  const dialogRef = useRef<VoiceDialog | null>(null);
  if (!dialogRef.current) dialogRef.current = new VoiceDialog();
  const engineRef = useRef<VoiceEngine | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const enabledRef = useRef(false);
  const onEnabledRef = useRef(props.onEnabledChange);
  onEnabledRef.current = props.onEnabledChange;
  const onResultCbRef = useRef(props.onVoiceResult);
  onResultCbRef.current = props.onVoiceResult;
  useEffect(() => { onEnabledRef.current?.(enabled); }, [enabled]);
  const modeRef = useRef<EngineMode>('auto');
  modeRef.current = engineMode;
  const localReadyRef = useRef(false);
  localReadyRef.current = localSupport?.availability === 'available';

  useEffect(() => {
    try { setUsePhrases(window.localStorage.getItem(PHRASES_KEY) === '1'); setBargeIn(window.localStorage.getItem(BARGE_KEY) !== '0'); } catch { /* ignoré */ }
    void loadShared().then(setShared);
    // Profil vocal du COMPTE (base) : suit l'utilisateur d'un PC à une tablette. Anciennes variantes locales : reprises une fois.
    void loadProfile(props.userId).then(({ profile: p, fromDb }) => {
      let merged = sanitizeProfile(p);   // retire les corrections dangereuses apprises avant (« pas », « avec »…)
      const legacy = readAliases();
      for (const [k, list] of Object.entries(legacy)) for (const w of list) merged = addAliasTo(merged, k, w);
      profileRef.current = merged;
      setProfile(merged);
      setProfileSync(fromDb ? 'saved' : 'offline');
      if (merged !== p) persistProfile(merged);
      else if (Object.keys(legacy).length) { try { window.localStorage.removeItem(ALIAS_KEY); } catch { /* ignoré */ } }
    });
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    try { const m = window.localStorage.getItem(MODE_KEY); if (m === 'auto' || m === 'cloud' || m === 'local') setEngineMode(m); } catch { /* ignoré */ }
    void checkLocalSupport().then(setLocalSupport);
  }, []);

  // Enregistre le profil sur le compte (regroupe les modifications rapprochées ; hors ligne : gardé en local puis renvoyé).
  const persistProfile = (next: VoiceProfile) => {
    profileRef.current = next;
    setProfile(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const ok = await saveProfile(props.userId, profileRef.current);
      setProfileSync(ok ? 'saved' : 'offline');
      if (ok) { try { window.localStorage.removeItem(ALIAS_KEY); } catch { /* ignoré */ } }
    }, 600);
  };

  const changeMode = (m: EngineMode) => {
    setEngineMode(m);
    modeRef.current = m;
    try { window.localStorage.setItem(MODE_KEY, m); } catch { /* ignoré */ }
    engineRef.current?.refresh();
  };
  const prepareOffline = async () => {
    setInstalling(true);
    setMessage(null);
    const ok = await installLocal();
    setLocalSupport(await checkLocalSupport());
    setInstalling(false);
    if (!ok) setMessage("Le téléchargement du français pour le mode hors ligne n'a pas abouti (réseau, ou fonction absente de cette version de Chrome).");
  };

  // ───── Exécution des actions décidées par le dialogue (via les adaptateurs de page.tsx)
  // Durée pendant laquelle la joueuse et la touche restent allumées avant que l'événement soit enregistré.
  const SHOW_BEFORE_MS = 120;
  const apply = async (a: VoiceAction) => {
    switch (a.t) {
      case 'event':
        actionsRef.current.highlight(a.playerId, a.action);
        await sleep(SHOW_BEFORE_MS);
        actionsRef.current.recordEvent(a.action, a.playerId, a.points);
        break;
      case 'opp': actionsRef.current.bumpScore('away', a.delta); break;
      case 'sub': actionsRef.current.applySubstitution(a.outs, a.ins); break;
      case 'ft': actionsRef.current.highlight(a.playerId, 'LF'); actionsRef.current.submitFreeThrows(a.playerId, a.made, a.attempts); break;
      case 'delete': actionsRef.current.deleteEvent(a.eventId); break;
      case 'clock': actionsRef.current.highlight(null, 'CHRONO'); actionsRef.current.setClockRunning(a.running); break;
      case 'subPanel': actionsRef.current.subPanel(a.op); break;
      case 'select': actionsRef.current.selectPlayer(a.playerId); break;
      case 'ftView': actionsRef.current.ftView(a.playerId, a.attempts); break;
    }
  };

  const handleSpeech = (alts: string[]) => {
    // Une phrase à la fois, dans l'ordre ; on laisse React afficher l'état à jour avant la suivante.
    chainRef.current = chainRef.current.then(() => Promise.race([(async () => {
      if (!enabledRef.current) return;
      const dialog = dialogRef.current as VoiceDialog;
      const res = dialog.handle(alts, viewRef.current);
      setHeard(alts);
      onResultCbRef.current?.({ say: res.say.join('. '), actions: res.actions.length, at: Date.now() });
      setUnknownHeard(res.unknown ?? '');
      // On répond tout de suite à voix haute ; l'écran s'allume pendant ce temps.
      setSaid(res.say.join('. '));
      const kindNow = res.actions.length ? 'ok' : dialog.mode !== 'idle' ? 'wait' : 'info';
      setJournal((j) => [{ at: new Date().toLocaleTimeString('fr-FR'), alts, said: res.say.join('. '), kind: kindNow }, ...j].slice(0, 40));
      setSaidKind(res.actions.length ? 'ok' : dialog.mode !== 'idle' ? 'wait' : /reconnue|n'est pas|pas de joueuse|impossible|faut|citée|déjà|cinq fautes|maximum|rien à|aucun/i.test(res.say.join(' ')) ? 'error' : 'info');
      setDialogStatus(dialog.status());
      if (res.say.length) engineRef.current?.speak(res.say);
      for (let i = 0; i < res.actions.length; i++) {
        if (i > 0) await sleep(5); // identifiants d'événements = Date.now() : jamais deux dans la même milliseconde
        await apply(res.actions[i]);
      }
      if (res.actions.length) await sleep(30);
    })(), sleep(6000)])).catch(() => undefined);   // une étape qui traîne ne bloque jamais les commandes suivantes
  };

  // Réponse anticipée : dès que le texte provisoire est une commande complète et ne bouge plus pendant EARLY_MS,
  // on l'exécute sans attendre la fin du silence que Chrome met ~1 s à constater. Le résultat « final » de la même phrase est alors ignoré.
  const EARLY_MS = 400;
  const earlyKeyRef = useRef<string | null>(null);
  const interimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onInterim = (alts: string[], meta: { key: string }) => {
    if (!enabledRef.current || earlyKeyRef.current === meta.key) return;
    if (interimTimer.current) clearTimeout(interimTimer.current);
    interimTimer.current = setTimeout(() => {
      interimTimer.current = null;
      if (!enabledRef.current) return;
      if (dialogRef.current?.peek(alts, viewRef.current)) { earlyKeyRef.current = meta.key; handleSpeech(alts); }
    }, EARLY_MS);
  };
  const onFinal = (alts: string[], meta?: { key: string }) => {
    if (interimTimer.current) { clearTimeout(interimTimer.current); interimTimer.current = null; }
    if (meta && earlyKeyRef.current === meta.key) { earlyKeyRef.current = null; return; }   // déjà traitée en avance
    handleSpeech(alts);
  };

  const stopVoice = (note?: string, speakNote?: string) => {
    enabledRef.current = false;
    setEnabled(false);
    const eng = engineRef.current;
    engineRef.current = null;
    if (eng) {
      if (speakNote) { eng.speak(speakNote); setTimeout(() => eng.stop(), 2500); } // on laisse finir la phrase
      else eng.stop();
    }
    wakeRef.current?.release(); wakeRef.current = null;
    dialogRef.current?.cancel();
    setDialogStatus('À l’écoute');
    setEngineState('off');
    if (note !== undefined) setMessage(note);
  };

  const startVoice = () => {
    setMessage(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false && !(localReadyRef.current && modeRef.current !== 'cloud')) {
      setMessage("Hors ligne : la reconnaissance sur l'appareil n'est pas prête. Connectez-vous une fois et touchez « Préparer le mode hors ligne » (bouton Moteur). Les boutons fonctionnent comme d’habitude.");
      return;
    }
    if (!isRecognitionSupported()) {
      setMessage('Ce navigateur ne gère pas la reconnaissance vocale. Utilisez Chrome (Android ou ordinateur).');
      return;
    }
    if (viewRef.current.players.length === 0) { setMessage('Aucune joueuse dans le match : configurez d’abord le match.'); return; }
    const engine = new VoiceEngine({
      onResult: onFinal,
      onInterim,
      onState: setEngineState,
      onFatal: (_kind, msg) => stopVoice(msg),
      onEngine: setActiveEngine,
      getBargeIn: () => bargeRef.current,
      onDebug: (l) => { engineBuf.current = [`${new Date().toLocaleTimeString('fr-FR')} ${l}`, ...engineBuf.current].slice(0, 30); if (diagRef.current) setEngineLog(engineBuf.current); },
      getMode: () => modeRef.current,
      getPhrases: (): PhraseHint[] => !phrasesRef.current ? [] : [
        ...viewRef.current.players.flatMap((p) => (p.name ? [p.name, ...(p.aliases ?? [])] : [])).map((phrase) => ({ phrase, boost: 5 })),
        ...VOCAB.map((phrase) => ({ phrase, boost: 2 })),
      ],
    });
    engineRef.current = engine;
    dialogRef.current?.cancel();
    enabledRef.current = true;
    setEnabled(true);
    setHeard([]); setSaid('');
    setDialogStatus('À l’écoute');
    if (!engine.start()) { stopVoice('Impossible de démarrer la reconnaissance vocale.'); return; }
    wakeRef.current = holdWakeLock();
    if (isSynthesisSupported()) engine.speak('Commande vocale activée');
  };

  const toggle = () => { if (enabled) stopVoice(); else startVoice(); };

  // Hors ligne : le mode vocal se coupe et l'annonce ; les boutons continuent de tout faire.
  useEffect(() => {
    const goOffline = () => {
      setOnline(false);
      if (!enabledRef.current) return;
      if (localReadyRef.current && modeRef.current !== 'cloud') {
        engineRef.current?.refresh(); // bascule sur la reconnaissance de l'appareil
        engineRef.current?.speak('Hors ligne.');
      } else stopVoice('Réseau perdu : commande vocale coupée (le mode hors ligne n’est pas installé). Les boutons fonctionnent.', 'Plus de réseau. Commande vocale coupée.');
    };
    const goOnline = () => { setOnline(true); if (enabledRef.current) engineRef.current?.refresh(); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Démontage (changement d'onglet) : tout couper proprement.
  useEffect(() => () => {
    enabledRef.current = false;
    engineRef.current?.stop();
    wakeRef.current?.release();
  }, []);

  // Apprentissage rapide : un mot non reconnu peut être rattaché à une joueuse d'un seul toucher.
  const addAlias = (first: string, word: string) => {
    const before = profileRef.current;
    const after = addAliasTo(before, first, word);
    persistProfile(after);
    void shareEntries(profileDelta(before, after));
    setUnknownHeard('');
    setSaid(`« ${word} » compris comme ${first}`);
    setSaidKind('info');
  };

  const saveAlias = (first: string, text: string) => {
    const list = text.split(',').map((x) => strip(x)).filter(Boolean);
    const key = strip(first);
    const aliasesNext = { ...profileRef.current.aliases };
    if (list.length) aliasesNext[key] = list; else delete aliasesNext[key];
    const before = profileRef.current;
    const after = { ...before, aliases: aliasesNext };
    persistProfile(after);
    void shareEntries(profileDelta(before, after));
  };

  const namedPlayers = props.roster.filter((p) => firstNameOf(p.name));

  // Exemples de l'aide : prénoms et numéros tirés au hasard (parmi l'effectif du match si possible).
  const rosterKey = props.roster.map((p) => p.id).join('|');
  const ex = useMemo(() => {
    const shuffle = <T,>(a: T[]): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
    const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
    const FALLBACK = ['Léa', 'Manon', 'Inès', 'Camille', 'Jade', 'Zoé', 'Emma', 'Lina', 'Sarah', 'Clara', 'Nora', 'Louise', 'Eva', 'Lola', 'Julie'];
    const names = shuffle(props.roster.map((p) => firstNameOf(p.name)).filter(Boolean).map(cap));
    const p = [...names, ...shuffle(FALLBACK.filter((f) => !names.includes(f)))].slice(0, 10);
    const rn = shuffle(props.roster.map((x) => x.number));
    const n = [...rn, ...shuffle(Array.from({ length: 30 }, (_, i) => i + 1).filter((x) => !rn.includes(x)))].slice(0, 5);
    return { p, n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);
  const statusText = !enabled ? 'Voix coupée' : engineState === 'listening' ? dialogStatus : STATE_LABEL[engineState];
  const waiting = enabled && dialogStatus !== 'À l’écoute';

  return (
    <>
    <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-3xl shadow-xl space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={!enabled && !online && !(localSupport?.availability === 'available' && engineMode !== 'cloud')}
          title={!online && !enabled ? 'Indisponible sans réseau' : 'Activer / couper la commande vocale'}
          className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black tracking-wide border transition disabled:opacity-40 ${enabled ? 'bg-emerald-600 border-emerald-300 text-white shadow' : 'bg-slate-800 border-slate-600 text-slate-300'}`}
        >
          <span className="text-base">{enabled ? '🎙️' : '🔇'}</span>
          <span>COMMANDE VOCALE : {enabled ? 'ACTIVE' : 'COUPÉE'}</span>
        </button>
        <div className="flex items-center gap-1">
          {props.tutorial && (
            <button type="button" onClick={props.tutorial.onClick} title={props.tutorial.title}
              className={`text-[10px] font-bold px-2 py-1 rounded-lg border text-white ${props.tutorial.kind === 'quit' ? 'bg-rose-700 border-rose-400' : props.tutorial.kind === 'new' ? 'bg-slate-800 border-slate-600 text-amber-300' : 'bg-indigo-700 border-indigo-400'}`}>
              {props.tutorial.label}
            </button>
          )}
          <button type="button" onClick={() => { if (enabledRef.current) stopVoice(); setShowCal(true); }} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-indigo-700 border border-indigo-400 text-white">Calibrer</button>
          <button type="button" onClick={() => setShowEngine((v) => !v)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">Moteur</button>
          <button type="button" onClick={() => setShowNames((v) => !v)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">Prénoms</button>
          <button type="button" onClick={() => setShowHelp((v) => !v)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">Aide</button>
        </div>
      </div>

      {enabled && (
        <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[11px] font-bold ${waiting ? 'bg-amber-500/20 border border-amber-400/60 text-amber-200' : 'bg-slate-800/80 border border-slate-700 text-slate-300'}`}>
          <span className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${engineState === 'listening' ? 'bg-emerald-400 animate-pulse' : engineState === 'speaking' ? 'bg-sky-400' : 'bg-slate-500'}`} />
            {statusText}
          </span>
          <button type="button" onClick={() => { dialogRef.current?.cancel(); setDialogStatus('À l’écoute'); engineRef.current?.refresh(); }} title="Relancer l'écoute (si l'appli ne réagit plus)" className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-600">↻ Relancer</button>
          {waiting && (
            <button type="button" onClick={() => { dialogRef.current?.cancel(); setDialogStatus('À l’écoute'); engineRef.current?.speak('Annulé.'); setSaid('Annulé.'); }} className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-slate-900 border border-amber-400/60">Abandonner</button>
          )}
        </div>
      )}

      {!online && !enabled && localSupport?.availability !== 'available' && <p className="text-[10px] text-amber-300 font-semibold">Hors connexion : mode hors ligne non prêt (bouton Moteur), les boutons fonctionnent.</p>}
      {message && <p className="text-[11px] text-rose-300 font-semibold">{message}</p>}

      {enabled && said && (
        <p className={`text-xs font-black rounded-xl px-3 py-2 border ${saidKind === 'ok' ? 'bg-emerald-600/25 border-emerald-400 text-emerald-100' : saidKind === 'wait' ? 'bg-amber-500/20 border-amber-400 text-amber-100' : saidKind === 'error' ? 'bg-rose-600/25 border-rose-400 text-rose-100' : 'bg-slate-800 border-slate-600 text-slate-100'}`}>
          {saidKind === 'ok' ? '✅ ' : saidKind === 'wait' ? '⏳ ' : saidKind === 'error' ? '⚠️ ' : '💬 '}{said}
        </p>
      )}
      {enabled && unknownHeard && (
        <div className="bg-slate-950/60 border border-slate-700 rounded-xl p-2 space-y-1">
          <p className="text-[10px] text-slate-400">Mot non reconnu : <b className="text-slate-200">« {unknownHeard} »</b> — c’est un prénom ? Touchez la joueuse :</p>
          <div className="flex flex-wrap gap-1">
            {namedPlayers.map((p) => {
              const first = firstNameOf(p.name);
              return <button key={p.id} type="button" onClick={() => addAlias(first, unknownHeard)} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-600 text-slate-200">{first}</button>;
            })}
            <button type="button" onClick={() => setUnknownHeard('')} className="text-[10px] px-2 py-1 rounded-lg text-slate-500">Ignorer</button>
          </div>
        </div>
      )}
      {enabled && diag && (
        <div className="text-[10px] text-slate-400 font-mono bg-slate-950/60 rounded-lg p-2 space-y-0.5">
          <p>Entendu :</p>
          {heard.length === 0 ? <p>—</p> : heard.map((h, i) => <p key={i}>{i + 1}. {h}</p>)}
          <p className="pt-1 text-slate-300">Événements du moteur (les plus récents d’abord) :</p>
          {engineLog.slice(0, 10).map((l, i) => <p key={i} className="text-slate-500">{l}</p>)}
          <p className="pt-1 text-slate-300">Journal ({journal.length}) :</p>
          {journal.slice(0, 8).map((j, i) => <p key={i}>{j.at} · {j.kind} · « {j.alts[0]} » → {j.said || '—'}</p>)}
          <button type="button" onClick={() => { try { void navigator.clipboard.writeText(journal.map((j) => `${j.at}\t${j.kind}\t${j.alts.join(' | ')}\t=> ${j.said}`).join('\n') + '\n--- événements du moteur ---\n' + [...engineLog].reverse().join('\n')); } catch { /* ignoré */ } }} className="mt-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-600 text-slate-200 font-sans">Copier le journal (pour l'envoyer)</button>
        </div>
      )}
      {enabled && (
        <label className="flex items-center gap-2 text-[10px] text-slate-500 select-none">
          <input type="checkbox" checked={diag} onChange={(e: { target: { checked: boolean } }) => { diagRef.current = e.target.checked; if (e.target.checked) setEngineLog(engineBuf.current); setDiag(e.target.checked); }} /> Mode diagnostic (afficher le texte entendu)
        </label>
      )}

      {showEngine && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-1.5 text-[11px] text-slate-300">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-200">Reconnaissance</span>
            <select value={engineMode} onChange={(e: { target: { value: string } }) => changeMode(e.target.value as EngineMode)} className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white">
              <option value="auto">Automatique (en ligne, sinon sur l’appareil)</option>
              <option value="cloud">Toujours en ligne</option>
              <option value="local">Toujours sur l’appareil</option>
            </select>
          </div>
          <p>Moteur en cours : <b>{activeEngine === 'local' ? 'sur l’appareil (sans réseau)' : activeEngine === 'cloud' ? 'en ligne' : '—'}</b></p>
          <p>
            Mode hors ligne :{' '}
            {!localSupport ? 'vérification…'
              : localSupport.availability === 'available' ? <b className="text-emerald-300">prêt ✓</b>
              : localSupport.availability === 'downloading' ? 'téléchargement en cours…'
              : localSupport.api && localSupport.availability !== 'unavailable' ? <span className="text-amber-300">français non installé</span>
              : <span className="text-rose-300">non disponible sur cet appareil (Chrome 139 ou plus récent requis, et selon la tablette)</span>}
          </p>
          {localSupport && localSupport.api && localSupport.availability !== 'available' && localSupport.availability !== 'unavailable' && (
            <button type="button" disabled={installing || !online} onClick={prepareOffline} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-40">{installing ? 'Téléchargement…' : 'Préparer le mode hors ligne'}</button>
          )}
          <label className="flex items-center gap-2 select-none">
            <input type="checkbox" checked={bargeIn} onChange={(e: { target: { checked: boolean } }) => { setBargeIn(e.target.checked); bargeRef.current = e.target.checked; try { window.localStorage.setItem(BARGE_KEY, e.target.checked ? '1' : '0'); } catch { /* ignoré */ } engineRef.current?.refresh(); }} />
            Casque : continuer d’écouter pendant que l’appli parle (réponse plus rapide ; à décocher sans casque)
          </label>
          <label className="flex items-center gap-2 select-none">
            <input type="checkbox" checked={usePhrases} onChange={(e: { target: { checked: boolean } }) => { setUsePhrases(e.target.checked); try { window.localStorage.setItem(PHRASES_KEY, e.target.checked ? '1' : '0'); } catch { /* ignoré */ } engineRef.current?.refresh(); }} />
            Favoriser les prénoms et commandes auprès de Chrome (essai : à décocher si les prénoms sont moins bien compris)
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <span>Mon calibrage : {Object.values(profile.aliases).reduce((n, l) => n + l.length, 0)} variantes, {Object.keys(profile.wordFixes).length} corrections · Club : {Object.values(shared.aliases).reduce((n, l) => n + l.length, 0)} variantes, {Object.keys(shared.wordFixes).length} corrections</span>
            <button type="button" onClick={() => { if (window.confirm('Effacer votre calibrage personnel (variantes de prénoms et corrections apprises) ? Les apprentissages communs du club restent.')) persistProfile(emptyProfile()); }} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-600 text-slate-200">Effacer mon calibrage</button>
          </div>
          <p className="text-slate-500">À faire une fois, avec du réseau. Liste de mots favorisés (prénoms, commandes) : {localSupport?.phrases ? 'active' : 'non gérée par ce Chrome'}.</p>
        </div>
      )}

      {showNames && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-1.5">
          <p className="text-[10px] text-slate-400">Variantes de prononciation, séparées par des virgules (ex. « candy, kandis »). Enregistrées sur votre compte et partagées avec le club {profileSync === 'saved' ? '✓' : profileSync === 'offline' ? '(hors ligne : envoi dès que possible)' : ''}{profile.calibratedAt ? ` · dernier calibrage le ${new Date(profile.calibratedAt).toLocaleDateString('fr-FR')}` : ''}.</p>
          {namedPlayers.length === 0 && <p className="text-[10px] text-slate-500">Aucune joueuse avec un prénom.</p>}
          {namedPlayers.map((p) => {
            const first = firstNameOf(p.name);
            return (
              <div key={p.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[11px] font-bold text-slate-200 truncate">#{p.number} {first}</span>
                <input
                  type="text"
                  defaultValue={(aliases[strip(first)] ?? []).join(', ')}
                  onBlur={(e: { target: { value: string } }) => saveAlias(first, e.target.value)}
                  placeholder="variantes…"
                  className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white"
                />
              </div>
            );
          })}
        </div>
      )}

      {showHelp && (
        <div className="text-[11px] text-slate-300 bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-1.5 leading-snug">
          <p className="font-bold text-slate-100">Commandes vocales (les prénoms et numéros ci-dessous sont des exemples tirés au hasard)</p>
          <p><b>Désigner une joueuse</b> : son prénom, ou son numéro (« la {ex.n[0]} », « le {ex.n[1]} », « numéro {ex.n[2]} », « {ex.n[3]} »). L’ordre est libre : « {ex.p[0]} deux points » = « deux points pour {ex.p[0]} ». Les actions sont enregistrées tout de suite, sans validation ; pour corriger, dites « annule ».</p>
          <p><b>Sélectionner</b> : « sélectionne {ex.p[1]} », « sélectionner la {ex.n[4]} », « désélectionner ». La joueuse sélectionnée (ou touchée à l’écran) sert de joueuse par défaut : « deux points », « interception », « lancer franc » suffisent.</p>
          <p><b>Chrono</b> : « démarrer chrono », « démarrer le match », « début match », « reprise du jeu » ; « arrêt chrono », « arrêter chrono », « stop chrono », « temps mort ». Prévoir 1 à 3 secondes de décalage entre la voix et l’effet.</p>
          <p><b>Tirs</b> : « {ex.p[2]} deux points », « 3 points pour {ex.p[3]} », « raté à trois points pour {ex.p[4]} », « tir à 2 points manqué {ex.p[5]} ».</p>
          <p><b>Autres actions</b> : « interception {ex.p[6]} », « rebond offensif / défensif {ex.p[7]} », « passe décisive {ex.p[8]} », « perte de balle de {ex.p[9]} » ou « balle perdue », « contre de {ex.p[0]} », « {ex.p[1]} contrée ». « Rebond » seul : l’appli demande offensif ou défensif.</p>
          <p><b>Fautes</b> : « faute de {ex.p[2]} » (personnelle), « faute sur {ex.p[3]} » ou « faute subie » ; « faute technique / antisportive / disqualifiante {ex.p[4]} ». Annonce de la 4e et de la 5e faute (« elle sort »).</p>
          <p><b>Lancers francs</b> : « lancer franc » (joueuse sélectionnée) ou « lancer franc {ex.p[5]} » ; les tentatives s’affichent à l’écran : « premier réussi », « deuxième raté » ou simplement « réussi » / « raté ». Après la 3e tentative, ou « terminé », c’est enregistré. En une phrase : « {ex.p[6]} 1/3 », « {ex.p[7]} deux sur trois ». « Annule » abandonne la série.</p>
          <p><b>Changements</b> (enregistrés tout de suite, sans « oui ») : « remplacement {ex.p[8]}, {ex.p[9]} par {ex.p[0]}, {ex.p[1]} », « sortie de … entrée de … », « sur le terrain on a [5 prénoms ou numéros] ». Fenêtre : « afficher changement », puis « valider » ou « fermer ».</p>
          <p><b>Annuler</b> : « annule la dernière commande » ou « annule dernière action {ex.p[2]} » : immédiat, sans validation. Un changement ne s’annule pas : faire un nouveau changement.</p>
          <p><b>Score adverse</b> : « adversaire deux points », « adversaire moins un ». <b>Questions</b> : « score », « qui est sur le terrain », « combien de fautes {ex.p[3]} », « fautes équipe ».</p>
          <p><b>Didacticiel</b> : bouton « Didacticiel » à gauche de « Calibrer » (si aucun match n’est ouvert) : un match de démonstration et une cinquantaine de commandes à essayer, sans rien enregistrer.</p>
          <p><b>Calibrage</b> : le bouton « Calibrer » fait lire toutes les phrases ; l’appli apprend les prénoms et mots mal compris et les enregistre sur votre compte (valable sur toutes vos tablettes et PC).</p>
          <p><b>Abandon</b> : si l’appli pose une question (« Quelle joueuse ? ») ou attend une suite, dites <b>« abandon »</b> (ou « ignorer », « oublie ») : l’attente est supprimée. Dire une autre commande complète fait la même chose.</p>
          <p><b>Conseils</b> : parlez normalement, sans exagérer ; une courte pause est acceptée (la phrase est recollée, et « sur le terrain on a… » attend les prénoms manquants). Les <b>numéros</b> (« deux points la 5 ») sont mieux compris que les prénoms. Si un prénom est mal entendu, touchez la joueuse sous « Mot non reconnu » : l’appli l’apprend.</p>
          <p className="text-amber-300">Confidentialité : le navigateur envoie l’audio à son fournisseur (Google pour Chrome). Hors ligne : possible si le mode hors ligne est prêt (bouton Moteur) ; sinon utilisez les boutons. Un casque évite que l’appli s’entende.</p>
        </div>
      )}
    </div>
    {showCal && (
        <VoiceCalibration
          players={players}
          profile={effective}
          getMode={() => modeRef.current}
          onSave={async (p) => { void shareEntries(profileDelta(effectiveRef.current, p)); profileRef.current = p; setProfile(p); const ok = await saveProfile(props.userId, p); setProfileSync(ok ? 'saved' : 'offline'); return ok; }}
          onClose={() => setShowCal(false)}
        />
      )}
    </>
  );
}
