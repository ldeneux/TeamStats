'use client';

import React, { useEffect, useMemo, useState } from 'react';
import ClubCalendar from './ClubCalendar';
import TeamTile from './TeamTile';
import {
  ClubPhase, ClubTeam, defaultPhase, loadClubTeams, loadPhases, phaseLabels, sortTeams,
} from '../lib/clubDb';
import { currentSeason } from '../lib/clubTeams';

const LS_SEL = 'teamstats:calendar-selection:v1';
const readSel = (userId: string): { team?: string; season?: string } => {
  try { return JSON.parse(window.localStorage.getItem(`${LS_SEL}:${userId}`) || '{}'); } catch { return {}; }
};
const writeSel = (userId: string, v: { team?: string; season?: string }) => {
  try { window.localStorage.setItem(`${LS_SEL}:${userId}`, JSON.stringify(v)); } catch { /* rien */ }
};

// Menu « Calendrier » : équipe (par image) -> saison (en cours par défaut) -> phase (en cours par défaut)
// -> « Calendrier & résultats » et « Classement ». Chaque compte ne voit que ses équipes (RLS).
export default function CalendarMenu({ userId, isAdmin, onOpenAdmin }: { userId: string; isAdmin: boolean; onOpenAdmin: () => void }) {
  const [teams, setTeams] = useState<ClubTeam[] | null>(null);
  const [error, setError] = useState('');
  const [season, setSeason] = useState('');
  const [teamId, setTeamId] = useState('');
  const [phases, setPhases] = useState<ClubPhase[] | null>(null);
  const [phaseId, setPhaseId] = useState('');

  useEffect(() => {
    let alive = true;
    loadClubTeams()
      .then((t) => {
        if (!alive) return;
        setTeams(t);
        const seasons = Array.from(new Set(t.map((x) => x.season))).sort().reverse();
        const saved = readSel(userId);
        const cur = currentSeason();
        const s = saved.season && seasons.includes(saved.season) ? saved.season : seasons.includes(cur) ? cur : seasons[0] || '';
        setSeason(s);
        const inSeason = sortTeams(t.filter((x) => x.season === s));
        setTeamId(inSeason.find((x) => x.id === saved.team)?.id ?? (inSeason.length === 1 ? inSeason[0].id : ''));
      })
      .catch((e) => alive && setError(e.message || String(e)));
    return () => { alive = false; };
  }, [userId]);

  const seasons = useMemo(() => Array.from(new Set((teams ?? []).map((t) => t.season))).sort().reverse(), [teams]);
  const seasonTeams = useMemo(() => sortTeams((teams ?? []).filter((t) => t.season === season)), [teams, season]);
  const team = seasonTeams.find((t) => t.id === teamId) ?? null;

  useEffect(() => {
    if (!team) { setPhases(null); setPhaseId(''); return; }
    let alive = true;
    setPhases(null);
    loadPhases(team.id)
      .then((p) => { if (!alive) return; setPhases(p); setPhaseId(defaultPhase(p)?.id ?? ''); })
      .catch((e) => alive && setError(e.message || String(e)));
    return () => { alive = false; };
  }, [team?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickSeason = (s: string) => {
    setSeason(s);
    const list = sortTeams((teams ?? []).filter((t) => t.season === s));
    const next = list.length === 1 ? list[0].id : '';
    setTeamId(next);
    writeSel(userId, { season: s, team: next });
  };
  const pickTeam = (id: string) => { setTeamId(id); writeSel(userId, { season, team: id }); };

  const labels = useMemo(() => phaseLabels(phases ?? []), [phases]);
  const phase = (phases ?? []).find((p) => p.id === phaseId) ?? null;

  if (error) return <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300 break-words">Lecture impossible : {error}. Vérifiez que sql/admin_01_club_calendar.sql a été exécuté.</p>;
  if (!teams) return <p className="py-10 text-center text-sm text-slate-400">Chargement…</p>;
  if (teams.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6 text-center text-sm text-slate-300 space-y-2">
        <p className="text-2xl">📅</p>
        <p className="font-bold text-white">Aucune équipe disponible</p>
        <p className="text-xs text-slate-400">
          {isAdmin ? 'Chargez les équipes du club depuis le cache FFBB.' : 'Aucune équipe ne vous est affectée : demandez à un administrateur de vous en ouvrir une.'}
        </p>
        {isAdmin && <button onClick={onOpenAdmin} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white">Ouvrir l&apos;administration</button>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-amber-500">Équipe</h2>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Saison
            <select value={season} onChange={(e) => pickSeason(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm font-bold text-white">
              {seasons.map((s) => <option key={s} value={s}>{s}{s === currentSeason() ? ' (en cours)' : ''}</option>)}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {seasonTeams.map((t) => <TeamTile key={t.id} team={t} selected={t.id === teamId} onClick={() => pickTeam(t.id)} />)}
        </div>
      </section>

      {team && phases && phases.length === 0 && <p className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 text-center text-sm text-slate-400">Aucune phase enregistrée pour cette équipe.</p>}

      {team && phases && phases.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {phases.map((p) => (
              <button key={p.id} onClick={() => setPhaseId(p.id)}
                className={`rounded-xl border px-3 py-2 text-left text-xs transition ${p.id === phaseId ? 'border-amber-500 bg-amber-500/15 text-white' : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500'}`}>
                <span className="block font-extrabold">{labels.get(p.id)}</span>
                <span className="block text-[11px] text-slate-400">{p.poule_label || 'Poule'}</span>
              </button>
            ))}
          </div>
          {phase && (
            <>
              <p className="text-xs text-slate-400">
                <span className="font-bold text-slate-200">{phase.competition_name || 'Compétition'}</span>
                {phase.poule_label ? ` · ${phase.poule_label}` : ''}
              </p>
              <ClubCalendar phase={phase} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
