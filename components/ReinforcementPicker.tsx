'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { allowedSources, loadRenfortTeams, RenfortTeam } from '../lib/renforts';

export interface Reinforcement { id: string; name: string; number: number; from: string }

// Renforts : on choisit D'ABORD l'équipe d'origine (parmi celles autorisées, voir lib/renforts.ts), puis les joueuses.
export default function ReinforcementPicker({ targetStatsTeamId, alreadyIds, onAdd, onClose }: {
  targetStatsTeamId: string; alreadyIds: string[]; onAdd: (players: Reinforcement[]) => void; onClose: () => void;
}) {
  const [teams, setTeams] = useState<RenfortTeam[] | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState<RenfortTeam | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRenfortTeams(targetStatsTeamId).then(setTeams).catch((e) => {
      setTeams([]);
      setError(/function|renfort_candidates|schema cache/i.test(e?.message || '') ? "Fonction manquante : exécutez sql/admin_10_merge_roster.sql dans Supabase." : e?.message || String(e));
    });
  }, [targetStatsTeamId]);

  const target = teams?.find((t) => t.isTarget) ?? null;
  const sources = useMemo(() => {
    if (!teams || !target) return [];
    const catN = (c: string | null) => { const m = /^U(\d+)$/.exec(c || ''); return m ? parseInt(m[1], 10) : 100; };
    return allowedSources(target, teams).sort((a, b) => catN(a.category) - catN(b.category) || String(a.sexe).localeCompare(String(b.sexe)) || (a.teamNumber ?? 0) - (b.teamNumber ?? 0));
  }, [teams, target]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const add = () => {
    if (!source) return;
    onAdd(source.players.filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, name: p.name, number: p.number, from: source.code })));
    onClose();
  };
  const available = source ? source.players.filter((p) => !alreadyIds.includes(p.id)) : [];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl p-5 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold text-emerald-400">{source ? `Renfort · ${source.label}` : 'Renfort : choisir l\'équipe d\'origine'}</h3>

        {teams === null && <p className="text-xs text-slate-400">Chargement…</p>}
        {error && <p className="text-xs text-rose-300 break-words">{error}</p>}
        {teams && !error && !target && <p className="text-xs text-slate-400">Cette équipe n&apos;est pas liée à une équipe du club (Administration &gt; Équipes &amp; calendriers) : pas de renfort possible.</p>}

        {!source && target && (
          <>
            <p className="text-[11px] text-slate-400">Pour {target.label} : même catégorie, catégorie juste en dessous ou au-dessus ; mixité en U9 et U11 (même catégorie).</p>
            {sources.length === 0 && <p className="text-xs text-slate-500">Aucune équipe autorisée.</p>}
            <div className="space-y-1.5">
              {sources.map((t) => (
                <button key={t.clubTeamId} disabled={t.players.length === 0} onClick={() => { setSource(t); setPicked(new Set()); }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-left text-sm font-bold text-white hover:border-emerald-500 disabled:opacity-40">
                  <span>{t.label}{t.sexe && target.sexe && t.sexe !== target.sexe ? <span className="ml-2 text-[10px] font-semibold text-emerald-300">mixte</span> : null}</span>
                  <span className="text-[11px] font-semibold text-slate-400">{t.players.length} joueuse{t.players.length > 1 ? 's' : ''}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {source && (
          <>
            {available.length === 0 && <p className="text-xs text-slate-500">Toutes les joueuses de cette équipe sont déjà sur la feuille.</p>}
            <div className="space-y-1.5">
              {available.map((p) => (
                <label key={p.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-bold ${picked.has(p.id) ? 'border-emerald-500 bg-emerald-500/15 text-white' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-emerald-500" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="text-[11px] font-semibold text-slate-400">#{p.number}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSource(null)} className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white">‹ Équipes</button>
              <button onClick={add} disabled={picked.size === 0} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-40">Ajouter ({picked.size})</button>
            </div>
          </>
        )}
        {!source && <button onClick={onClose} className="w-full rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white">Fermer</button>}
      </div>
    </div>
  );
}
