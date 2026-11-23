'use client';
// components/VoiceCalibration.tsx — calibrage complet de la commande vocale.
// L'utilisateur lit une liste de phrases (avec les prénoms de l'équipe) ; l'appli compare ce que le navigateur entend
// à ce qui était attendu, apprend les écarts (variantes de prénoms, corrections de mots) et les enregistre sur le COMPTE.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VoicePlayer } from '../lib/voice/commands';
import { CalDetail, CalPrompt, CalStatus, VoiceProfile, buildPrompts, calibrationSetup, evaluateHeard } from '../lib/voice/calibrate';
import { EngineMode, PhraseHint, VoiceEngine } from '../lib/voice/speech';

interface Props {
  players: VoicePlayer[];
  profile: VoiceProfile;
  getMode: () => EngineMode;
  onSave: (p: VoiceProfile) => Promise<boolean>;
  onClose: () => void;
}
type Res = CalStatus | 'skip';

const countLearned = (a: VoiceProfile, b: VoiceProfile) =>
  Object.values(b.aliases).reduce((n, l) => n + l.length, 0) - Object.values(a.aliases).reduce((n, l) => n + l.length, 0) +
  Object.keys(b.wordFixes).length - Object.keys(a.wordFixes).length;

type LogRow = { n: number; text: string; status: string; engine: string; alts: string[]; expected: string; understood: string; learned: string };
const journalText = (log: LogRow[]) => [...log].reverse().map((r) => `#${r.n} [${r.status}] moteur=${r.engine}\n  dit : ${r.text}\n  attendu : ${r.expected}\n  entendu : ${r.alts.join(' | ')}\n  compris : ${r.understood}${r.learned ? `\n  appris : ${r.learned}` : ''}`).join('\n');

function JournalBox({ log, open }: { log: LogRow[]; open?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!log.length) return null;
  return (
    <details open={open} className="bg-slate-900 border border-slate-700 rounded-2xl p-3 text-[11px]">
      <summary className="cursor-pointer font-bold text-slate-300">Journal du calibrage ({log.length})</summary>
      <div className="mt-2 space-y-1 max-h-56 overflow-auto font-mono text-slate-400">
        {log.slice(0, open ? 200 : 6).map((r, i) => (
          <p key={i}><span className={r.status === 'ok' ? 'text-emerald-300' : r.status === 'learned' ? 'text-indigo-300' : 'text-amber-300'}>#{r.n} {r.status}</span> « {r.text} » ← « {r.alts[0]} »</p>
        ))}
      </div>
      <button type="button" onClick={() => { try { void navigator.clipboard.writeText(journalText(log)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignoré */ } }}
        className="mt-2 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-slate-200">{copied ? 'Copié ✓' : 'Copier le journal complet (pour l’envoyer)'}</button>
    </details>
  );
}

export default function VoiceCalibration({ players, profile, getMode, onSave, onClose }: Props) {
  const setup = useMemo(() => calibrationSetup(players), [players]);
  const prompts: CalPrompt[] = useMemo(() => buildPrompts(setup), [setup]);
  const [phase, setPhase] = useState<'intro' | 'run' | 'done'>('intro');
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Res[]>([]);
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const [work, setWork] = useState<VoiceProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<null | boolean>(null);
  const [listening, setListening] = useState(false);
  const [detail, setDetail] = useState<CalDetail | null>(null);
  const [engineUsed, setEngineUsed] = useState<'cloud' | 'local' | null>(null);
  const [log, setLog] = useState<Array<{ n: number; text: string; status: string; engine: string; alts: string[]; expected: string; understood: string; learned: string }>>([]);

  const idxRef = useRef(0);
  const triesRef = useRef(0);
  const busyRef = useRef(false);
  const readyAtRef = useRef(0);   // un résultat reçu avant cet instant est la fin de la phrase précédente : ignoré
  const workRef = useRef<VoiceProfile>(profile);
  const resultsRef = useRef<Res[]>([]);
  const engineRef = useRef<VoiceEngine | null>(null);
  const engineUsedRef = useRef<'cloud' | 'local' | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = () => { engineRef.current?.stop(); engineRef.current = null; setListening(false); setPhase('done'); };
  const advance = (res: Res) => {
    resultsRef.current = [...resultsRef.current, res];
    setResults(resultsRef.current);
    triesRef.current = 0;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const next = idxRef.current + 1;
      if (next >= prompts.length) { finish(); return; }
      idxRef.current = next; setIdx(next); setHeard(''); setNote(''); setDetail(null); busyRef.current = false; readyAtRef.current = Date.now() + 900;
    }, 900);
  };

  const onResult = (alts: string[]) => {
    if (busyRef.current || phase !== 'run' || Date.now() < readyAtRef.current) return;
    const prompt = prompts[idxRef.current];
    if (!prompt) return;
    const r = evaluateHeard(prompt, alts, setup, workRef.current);
    setHeard(alts[0] ?? '');
    setDetail(r.detail);
    setLog((l) => [{ n: idxRef.current + 1, text: prompt.text, status: r.status === 'fail' && triesRef.current < 1 ? 'essai 1 raté' : r.status, engine: engineRef.current ? (engineUsedRef.current ?? '?') : '?', alts, expected: r.detail.expected, understood: r.detail.perAlt[0]?.understood ?? '', learned: r.detail.learned.map((x) => `${x.kind === 'alias' ? 'prénom' : 'mot'} « ${x.value} » → « ${x.key} »`.replace(/^mot « (.*) » → « (.*) »$/, (_m, a, b) => `mot « ${b} » → « ${a} »`)).join(' ; ') }, ...l]);
    if (r.status === 'fail' && triesRef.current < 1) {
      triesRef.current += 1;
      setNote('Pas compris : répétez la phrase.');
      return;
    }
    busyRef.current = true;
    if (r.status === 'learned') { workRef.current = r.profile; setWork(r.profile); setNote('Compris après correction apprise ✓'); }
    else setNote(r.status === 'ok' ? 'Compris ✓' : 'Toujours pas compris : on passe à la suivante.');
    advance(r.status);
  };
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (phase !== 'run') return;
    const eng = new VoiceEngine({
      onResult: (a) => onResultRef.current(a),
      onState: (s) => setListening(s === 'listening'),
      onFatal: (_k, msg) => { setNote(msg); finish(); },
      getMode,
      onEngine: (e) => { engineUsedRef.current = e; setEngineUsed(e); },
      getPhrases: (): PhraseHint[] => setup.players.map((p) => ({ phrase: p.name, boost: 5 })),
    });
    engineRef.current = eng;
    eng.start();
    return () => { eng.stop(); if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const skip = () => { if (busyRef.current) return; busyRef.current = true; setNote('Phrase passée.'); advance('skip'); };
  const start = () => { readyAtRef.current = Date.now() + 900; setSaved(null); idxRef.current = 0; triesRef.current = 0; busyRef.current = false; resultsRef.current = []; setResults([]); setIdx(0); setHeard(''); setNote(''); setPhase('run'); };
  const save = async () => {
    setSaving(true);
    const ok = await onSave({ ...workRef.current, calibratedAt: new Date().toISOString() });
    setSaving(false); setSaved(ok);
  };

  const cur = prompts[idx];
  const n = (s: Res) => results.filter((r) => r === s).length;
  const learned = countLearned(profile, work);

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/97 overflow-auto p-4" role="dialog" aria-modal="true" aria-label="Calibrage de la commande vocale">
      <div className="max-w-xl mx-auto space-y-4 text-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-amber-400">Calibrage de la commande vocale</h2>
          <button type="button" onClick={() => { engineRef.current?.stop(); onClose(); }} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600">Fermer ✕</button>
        </div>

        {phase === 'intro' && (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3 text-sm">
            <p>Lisez à voix haute les {prompts.length} phrases qui s’affichent, <b>comme en match</b> (casque sur la tête, ton naturel, sans exagérer). Environ 6 minutes.</p>
            <p>L’appli compare ce que le navigateur entend à la phrase attendue et <b>apprend vos corrections</b> : prénoms mal compris, mots de commande déformés. Rien n’est enregistré tant que vous ne validez pas, et aucun son n’est conservé : seulement du texte.</p>
            <p>Le résultat est <b>enregistré sur votre compte</b> : il suit sur toutes vos tablettes et PC.</p>
            {setup.players.length < 5 && <p className="text-amber-300">Moins de 5 joueuses avec un prénom dans le match : certaines phrases (changements) seront limitées.</p>}
            <button type="button" onClick={start} disabled={prompts.length === 0} className="w-full py-3 rounded-2xl bg-emerald-600 font-black text-white disabled:opacity-40">Commencer</button>
          </div>
        )}

        {phase === 'run' && cur && (
          <div className="space-y-3">
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${(100 * idx) / prompts.length}%` }} /></div>
            <p className="text-xs text-slate-400">{idx + 1} / {prompts.length} · {cur.group}</p>
            <div className="bg-slate-900 border border-slate-600 rounded-2xl p-6 text-center">
              <p className="text-[11px] text-slate-500 mb-2">Dites :</p>
              <p className="text-2xl font-black text-white leading-snug">« {cur.text} »</p>
            </div>
            <p className="text-xs text-center">{listening ? <span className="text-emerald-300">🎙️ à l’écoute…</span> : <span className="text-slate-500">démarrage du micro…</span>}</p>
            {detail && (
              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3 space-y-1.5 text-[11px]">
                <p className="text-slate-400">Moteur : <b className="text-slate-200">{engineUsed === 'local' ? 'sur l’appareil' : engineUsed === 'cloud' ? 'en ligne' : '—'}</b></p>
                <p className="text-slate-400">Attendu : <b className="text-emerald-300">{detail.expected}</b></p>
                <p className="text-slate-400">Propositions du navigateur :</p>
                {detail.perAlt.map((a, i) => (
                  <p key={i} className={`font-mono ${a.ok ? 'text-emerald-300' : 'text-slate-300'}`}>{a.ok ? '✓' : '✗'} {i + 1}. « {a.alt} » <span className="font-sans text-slate-500">→ compris : {a.understood}</span></p>
                ))}
                {detail.learned.length > 0 && <p className="text-indigo-300">Appris : {detail.learned.map((x) => (x.kind === 'alias' ? `prénom « ${x.value} » = ${x.key}` : `mot « ${x.key} » = « ${x.value} »`)).join(' ; ')}</p>}
              </div>
            )}
            {note && <p className={`text-sm text-center font-bold ${/✓/.test(note) ? 'text-emerald-300' : 'text-amber-300'}`}>{note}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={skip} className="flex-1 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm font-bold">Passer</button>
              <button type="button" onClick={finish} className="flex-1 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm font-bold">Terminer maintenant</button>
            </div>
            <JournalBox log={log} />
            <p className="text-[11px] text-center text-slate-500">✓ {n('ok')} comprises · ↻ {n('learned')} corrigées · ✗ {n('fail')} à retravailler</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-3 text-sm">
            <p className="text-base font-black text-white">Bilan</p>
            <p><b className="text-emerald-300">{n('ok') + n('learned')}</b> phrases comprises sur {results.length - n('skip')} lues ({n('ok')} d’emblée, {n('learned')} après correction).</p>
            <p><b>{learned > 0 ? learned : 0}</b> correction{learned > 1 ? 's' : ''} apprise{learned > 1 ? 's' : ''}.</p>
            {n('fail') > 0 && (
              <div className="text-xs text-amber-200">
                <p className="font-bold">À retravailler :</p>
                <ul className="list-disc pl-5">{results.map((r, i) => (r === 'fail' ? <li key={i}>{prompts[i]?.text}</li> : null))}</ul>
                <p className="mt-1 text-slate-400">Ces phrases restent mal comprises : en match, préférez les numéros (« deux points la 5 ») ou refaites le calibrage plus au calme.</p>
              </div>
            )}
            <button type="button" onClick={save} disabled={saving || saved === true} className="w-full py-3 rounded-2xl bg-emerald-600 font-black text-white disabled:opacity-40">{saving ? 'Enregistrement…' : saved === true ? 'Enregistré sur votre compte ✓' : 'Enregistrer sur mon compte'}</button>
            <JournalBox log={log} open />
            {saved === false && <p className="text-amber-300 text-xs">Pas de connexion à la base : le calibrage est gardé sur cet appareil et sera envoyé dès que possible.</p>}
            <div className="flex gap-2">
              <button type="button" onClick={start} className="flex-1 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm font-bold">Recommencer</button>
              <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm font-bold">Fermer</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
