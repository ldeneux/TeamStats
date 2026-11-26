'use client';
// components/VoiceTutorial.tsx — fenêtre du didacticiel de la commande vocale (≈ 50 étapes) sur un match de démonstration.
// Chaque étape dit quoi prononcer et ce qui doit se passer ; elle passe au vert dès que l'effet est visible à l'écran.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TutCheck, TutLast, TutSnap, TutStep } from '../lib/voice/tutorial';
import { playBeep } from '../lib/voice/speech';

interface Props {
  steps: TutStep[];
  snap: TutSnap;
  /** Dernière réponse de la commande vocale (horodatée) ; null tant que rien n'a été dit. */
  last: TutLast | null;
  onQuit: () => void;
}

export default function VoiceTutorial({ steps, snap, last, onQuit }: Props) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // Fenêtre déplaçable (si elle gêne la vue du match) : null = position d'origine (en bas, centrée).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = boxRef.current?.getBoundingClientRect(); if (!r) return;
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPos({ left: r.left, top: r.top });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current; const r = boxRef.current?.getBoundingClientRect(); if (!d || !r) return;
    const left = Math.min(Math.max(0, e.clientX - d.dx), Math.max(0, window.innerWidth - r.width));
    const top = Math.min(Math.max(0, e.clientY - d.dy), Math.max(0, window.innerHeight - 48));
    setPos({ left, top });
  };
  const onDragEnd = () => { dragRef.current = null; };
  const baseRef = useRef<TutSnap>(snap);
  const startedAt = useRef<number>(Date.now());
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const step = steps[idx];
  const lastStep = idx === steps.length - 1;

  // À chaque nouvelle étape : on retient l'état de départ (pour mesurer l'effet) et l'heure (pour ignorer ce qui a été dit avant).
  useEffect(() => { baseRef.current = snapRef.current; startedAt.current = Date.now(); setDone(false); }, [idx]);

  const check = useMemo<TutCheck>(() => ({
    cur: snap, base: baseRef.current,
    last: last && last.at >= startedAt.current ? last : null,
  }), [snap, last, idx]);

  const say = typeof step.say === 'function' ? step.say(check) : step.say;

  // Étape réussie : passage au vert, puis étape suivante.
  useEffect(() => {
    if (done || lastStep) return;
    let ok = false;
    try { ok = step.check(check); } catch { ok = false; }
    if (!ok) return;
    setDone(true);
    const t = setTimeout(() => setIdx((i) => Math.min(steps.length - 1, i + 1)), 1600);
    return () => clearTimeout(t);
  }, [check, done, lastStep, step, steps.length]);

  if (minimized) {
    return (
      <button type="button" onClick={() => setMinimized(false)} className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-indigo-600 text-white text-xs font-black shadow-xl">
        🎓 Didacticiel · étape {idx + 1}/{steps.length} (afficher)
      </button>
    );
  }

  return (
    <div
      ref={boxRef}
      className={`fixed z-40 ${pos ? '' : 'bottom-2 left-1/2 -translate-x-1/2'}`}
      style={{ width: 'min(36rem, calc(100vw - 16px))', ...(pos ? { left: pos.left, top: pos.top } : {}) }}
    >
      {/* fond opaque à 80 % : on voit le match à travers ; la fenêtre se déplace en faisant glisser son en-tête */}
      <div className="rounded-3xl border border-indigo-400/60 shadow-2xl p-4 space-y-2.5 max-h-[78vh] overflow-y-auto" style={{ backgroundColor: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(2px)' }}>
        <div className="flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing select-none" style={{ touchAction: 'none' }} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} title="Glissez pour déplacer la fenêtre">
          <p className="text-[11px] font-black text-indigo-300 uppercase tracking-wide">⠿ 🎓 {step.section}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">{idx + 1} / {steps.length}</span>
            <button type="button" onClick={() => setMinimized(true)} className="text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-800 border border-slate-600 text-slate-300">Réduire</button>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${(100 * (idx + (done ? 1 : 0))) / steps.length}%` }} /></div>

        {step.intro && <p className="text-sm text-slate-100 leading-snug">{step.intro}</p>}
        {step.beeps && (
          <div className="flex gap-2">
            <button type="button" onClick={() => playBeep('ok')} className="flex-1 py-2 rounded-xl bg-emerald-700/80 border border-emerald-400 text-xs font-black text-white">▶ 1 bip : fait ✓</button>
            <button type="button" onClick={() => playBeep('error')} className="flex-1 py-2 rounded-xl bg-rose-700/80 border border-rose-400 text-xs font-black text-white">▶ 2 bips : refusé ✗</button>
          </div>
        )}
        {say && (
          <div className={`rounded-2xl border px-4 py-3 text-center ${done ? 'border-emerald-400 bg-emerald-600/25' : 'border-amber-400/70 bg-amber-500/15'}`}>
            <p className="text-[11px] text-slate-300 mb-1">{done ? 'Reconnu ✓' : 'Dites :'}</p>
            <p className="text-xl font-black text-white leading-snug">« {say} »</p>
          </div>
        )}
        {say && step.alts && step.alts.length > 0 && (
          <div className="text-[11px] text-slate-300 leading-snug">
            <span className="font-bold text-slate-200">Au choix, vous pouvez aussi dire : </span>
            {step.alts.map((a, i) => <span key={i} className="inline-block mr-2 text-indigo-200">« {a} »</span>)}
          </div>
        )}
        <p className={`text-xs leading-snug ${done ? 'text-emerald-200' : 'text-slate-200'}`}>{done ? '✅ ' : '↳ '}{step.why}</p>
        {!snap.voiceEnabled && idx > 0 && <p className="text-[11px] text-amber-300">La commande vocale est coupée : touchez « COMMANDE VOCALE » pour l'activer.</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-xs font-bold disabled:opacity-30">‹ Précédent</button>
          {!lastStep && <button type="button" onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))} className="flex-1 py-2 rounded-xl bg-slate-800 border border-slate-600 text-xs font-bold">Passer ›</button>}
          <button type="button" onClick={onQuit} className="flex-1 py-2 rounded-xl bg-rose-700 text-white text-xs font-black">Quitter le didacticiel</button>
        </div>
      </div>
    </div>
  );
}
