'use client';
// components/VoiceControl.tsx — commande vocale de la saisie en direct (version en ligne, navigateur).
// Reçoit l'état du match et des fonctions d'action ; ne touche à rien d'autre dans l'application.
// Les boutons de l'écran restent l'interface de référence : ce composant ne fait que les « presser » à la voix.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VoiceDialog, VoiceAction, VoiceView } from '../lib/voice/dialog';
import { VoicePlayer, strip } from '../lib/voice/commands';
import { VoiceEngine, EngineState, holdWakeLock, isRecognitionSupported, isSynthesisSupported, WakeLockHandle } from '../lib/voice/speech';

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
}

interface Props {
  roster: VoiceRosterPlayer[];
  onCourtPlayerIds: string[];
  events: VoiceEventLike[];
  scoreHome: number;
  scoreAway: number;
  period: number;
  clockRunning: boolean;
  subPanel: { open: boolean; outCount: number; inCount: number };
  actions: VoiceActions;
}

const ALIAS_KEY = 'teamstats.voice.aliases.v1';
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
  const [diag, setDiag] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [online, setOnline] = useState(true);
  const [aliases, setAliases] = useState<Record<string, string[]>>({});

  // ───── Toujours lire l'état le plus récent depuis les rappels asynchrones de la reconnaissance
  const players: VoicePlayer[] = useMemo(
    () => props.roster.map((p) => {
      const first = firstNameOf(p.name);
      return { id: p.id, number: p.number, name: first, aliases: first ? aliases[strip(first)] ?? [] : [] };
    }),
    [props.roster, aliases],
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

  useEffect(() => { setAliases(readAliases()); setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false); }, []);

  // ───── Exécution des actions décidées par le dialogue (via les adaptateurs de page.tsx)
  const apply = (a: VoiceAction) => {
    const act = actionsRef.current;
    switch (a.t) {
      case 'event': act.recordEvent(a.action, a.playerId, a.points); break;
      case 'opp': act.bumpScore('away', a.delta); break;
      case 'sub': act.applySubstitution(a.outs, a.ins); break;
      case 'ft': act.submitFreeThrows(a.playerId, a.made, a.attempts); break;
      case 'delete': act.deleteEvent(a.eventId); break;
      case 'clock': act.setClockRunning(a.running); break;
      case 'subPanel': act.subPanel(a.op); break;
    }
  };

  const handleSpeech = (alts: string[]) => {
    // Une phrase à la fois, dans l'ordre ; on laisse React afficher l'état à jour avant la suivante.
    chainRef.current = chainRef.current.then(async () => {
      if (!enabledRef.current) return;
      const dialog = dialogRef.current as VoiceDialog;
      const res = dialog.handle(alts, viewRef.current);
      setHeard(alts);
      for (let i = 0; i < res.actions.length; i++) {
        if (i > 0) await sleep(5); // identifiants d'événements = Date.now() : jamais deux dans la même milliseconde
        apply(res.actions[i]);
      }
      if (res.actions.length) await sleep(30);
      setSaid(res.say.join('. '));
      setDialogStatus(dialog.status());
      engineRef.current?.speak(res.say);
    }).catch(() => undefined);
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
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setMessage('Pas de réseau : la commande vocale est indisponible. Les boutons fonctionnent comme d’habitude.');
      return;
    }
    if (!isRecognitionSupported()) {
      setMessage('Ce navigateur ne gère pas la reconnaissance vocale. Utilisez Chrome (Android ou ordinateur).');
      return;
    }
    if (viewRef.current.players.length === 0) { setMessage('Aucune joueuse dans le match : configurez d’abord le match.'); return; }
    const engine = new VoiceEngine({
      onResult: handleSpeech,
      onState: setEngineState,
      onFatal: (_kind, msg) => stopVoice(msg),
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
      if (enabledRef.current) stopVoice('Réseau perdu : commande vocale coupée. Les boutons fonctionnent.', 'Plus de réseau. Commande vocale coupée.');
    };
    const goOnline = () => setOnline(true);
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

  const saveAlias = (first: string, text: string) => {
    const list = text.split(',').map((s) => s.trim()).filter(Boolean);
    const next = { ...aliases };
    if (list.length) next[strip(first)] = list; else delete next[strip(first)];
    setAliases(next);
    writeAliases(next);
  };

  const namedPlayers = props.roster.filter((p) => firstNameOf(p.name));
  const statusText = !enabled ? 'Voix coupée' : engineState === 'listening' ? dialogStatus : STATE_LABEL[engineState];
  const waiting = enabled && dialogStatus !== 'À l’écoute';

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-3 rounded-3xl shadow-xl space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={toggle}
          disabled={!enabled && !online}
          title={!online && !enabled ? 'Indisponible sans réseau' : 'Activer / couper la commande vocale'}
          className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-black tracking-wide border transition disabled:opacity-40 ${enabled ? 'bg-emerald-600 border-emerald-300 text-white shadow' : 'bg-slate-800 border-slate-600 text-slate-300'}`}
        >
          <span className="text-base">{enabled ? '🎙️' : '🔇'}</span>
          <span>COMMANDE VOCALE : {enabled ? 'ACTIVE' : 'COUPÉE'}</span>
        </button>
        <div className="flex items-center gap-1">
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
          {waiting && (
            <button type="button" onClick={() => { dialogRef.current?.cancel(); setDialogStatus('À l’écoute'); engineRef.current?.speak('Annulé.'); setSaid('Annulé.'); }} className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-slate-900 border border-amber-400/60">Abandonner</button>
          )}
        </div>
      )}

      {!online && !enabled && <p className="text-[10px] text-amber-300 font-semibold">Hors connexion : commande vocale indisponible, les boutons fonctionnent.</p>}
      {message && <p className="text-[11px] text-rose-300 font-semibold">{message}</p>}

      {enabled && said && <p className="text-[11px] text-slate-300"><span className="text-slate-500">Dit : </span>{said}</p>}
      {enabled && diag && (
        <div className="text-[10px] text-slate-400 font-mono bg-slate-950/60 rounded-lg p-2 space-y-0.5">
          <p>Entendu :</p>
          {heard.length === 0 ? <p>—</p> : heard.map((h, i) => <p key={i}>{i + 1}. {h}</p>)}
        </div>
      )}
      {enabled && (
        <label className="flex items-center gap-2 text-[10px] text-slate-500 select-none">
          <input type="checkbox" checked={diag} onChange={(e: { target: { checked: boolean } }) => setDiag(e.target.checked)} /> Mode diagnostic (afficher le texte entendu)
        </label>
      )}

      {showNames && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2 space-y-1.5">
          <p className="text-[10px] text-slate-400">Variantes de prononciation, séparées par des virgules (ex. « Candy, kandis »). Enregistrées sur cet appareil.</p>
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
          <p className="font-bold text-slate-100">Commandes (prénom ou « la 5 » pour le numéro)</p>
          <p>Tirs : « Chloé deux points », « raté à trois points pour Chloé ».</p>
          <p>Actions : « interception », « rebond offensif / défensif », « passe décisive », « perte de balle de », « contre de », « Chloé contrée ».</p>
          <p>Fautes : « faute de Chloé » (personnelle), « faute sur Chloé » (subie), « faute technique / antisportive / disqualifiante » (à confirmer).</p>
          <p>Lancers francs : « lancer franc Chloé », puis « premier réussi », « deuxième raté », « terminé » — ou en une phrase « Chloé 1/3 ».</p>
          <p>Changements (à confirmer par « oui ») : « remplacement Chloé, Laura par Hinde, Hanaé », « sortie de… entrée de… », « sur le terrain on a [5 prénoms] ».</p>
          <p>Fenêtre de changement : « afficher changement », puis cocher à l’écran et « valider », ou « fermer ».</p>
          <p>Annuler : « annuler la dernière commande » ou « annuler dernière action Chloé », puis « oui ». Un changement ne s’annule pas : faire un nouveau changement.</p>
          <p>Chrono : « démarrer chrono », « arrêt chrono », « début match », « reprise du jeu », « temps mort ». Prévoir 1 à 3 secondes de décalage entre la voix et l’effet.</p>
          <p>Questions : « score », « qui est sur le terrain », « combien de fautes Chloé », « fautes équipe ». Score adverse : « adversaire deux points ».</p>
          <p className="text-amber-300">Confidentialité : le navigateur envoie l’audio à son fournisseur (Google pour Chrome). Nécessite du réseau ; sans réseau, utilisez les boutons. Un casque évite que l’appli s’entende.</p>
        </div>
      )}
    </div>
  );
}
