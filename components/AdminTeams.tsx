'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClubCalendar from './ClubCalendar';
import TeamTile from './TeamTile';
import { adminApi } from '../lib/adminApi';
import { supabase } from '../lib/supabase';
import { ClubPhase, ClubTeam, fmtDateTimeLocal, fmtDay, loadClubTeams, loadPhases, phaseLabels, sortTeams } from '../lib/clubDb';
import { currentSeason } from '../lib/clubTeams';

// Programme à lancer depuis un PC pour (re)charger le cache FFBB (même fichier que dans l'appli Multisports).
const EXE_URL = process.env.NEXT_PUBLIC_FFBB_EXE_URL || 'https://multisports-eosin.vercel.app/MiseAJourFFBB_Club.exe';

interface PouleResult { pouleId: string; status: 'ok' | 'ignoree' | 'erreur'; message: string; teams: string[]; matches: number }
const BATCH = 3;

export default function AdminTeams() {
  const [teams, setTeams] = useState<ClubTeam[] | null>(null);
  const [error, setError] = useState('');
  const [season, setSeason] = useState(currentSeason());
  const [teamId, setTeamId] = useState('');
  const [phases, setPhases] = useState<ClubPhase[] | null>(null);
  const [phaseId, setPhaseId] = useState('');
  const [phaseCounts, setPhaseCounts] = useState<Record<string, number>>({});

  // chargement du cache
  const [cacheInfo, setCacheInfo] = useState<{ n: number; last: string | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<PouleResult[] | null>(null);
  const [syncError, setSyncError] = useState('');

  const refreshTeams = useCallback(async () => {
    try {
      const t = await loadClubTeams();
      setTeams(t);
      setError('');
      const { data } = await supabase.from('stats_club_phases').select('club_team_id');
      const c: Record<string, number> = {};
      for (const r of (data ?? []) as { club_team_id: string }[]) c[r.club_team_id] = (c[r.club_team_id] || 0) + 1;
      setPhaseCounts(c);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);

  const refreshCache = useCallback(async () => {
    try {
      const r = await adminApi<{ season: string; poules: { poule_id: string; fetched_at: string }[] }>('/api/admin/club-sync', 'POST', { action: 'list' });
      const last = r.poules.map((p) => p.fetched_at).sort().pop() ?? null;
      setCacheInfo({ n: r.poules.length, last });
    } catch (e: any) {
      setSyncError(e?.message || String(e));
    }
  }, []);

  useEffect(() => { void refreshTeams(); void refreshCache(); }, [refreshTeams, refreshCache]);

  const loadFromCache = async () => {
    setRunning(true); setSyncError(''); setResults(null);
    try {
      const list = await adminApi<{ season: string; poules: { poule_id: string }[] }>('/api/admin/club-sync', 'POST', { action: 'list' });
      const ids = list.poules.map((p) => p.poule_id);
      if (ids.length === 0) throw new Error('Le cache FFBB est vide : lancez d\'abord MiseAJourFFBB_Club.exe depuis un PC.');
      setProgress({ done: 0, total: ids.length });
      const all: PouleResult[] = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        const r = await adminApi<{ results: PouleResult[] }>('/api/admin/club-sync', 'POST', { action: 'process', pouleIds: ids.slice(i, i + BATCH) });
        all.push(...r.results);
        setProgress({ done: Math.min(i + BATCH, ids.length), total: ids.length });
        setResults([...all]);
      }
      await refreshTeams();
      setPhases(null);
      if (teamId) setPhases(await loadPhases(teamId));
    } catch (e: any) {
      setSyncError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  const seasons = useMemo(() => {
    const s = new Set((teams ?? []).map((t) => t.season));
    s.add(currentSeason());
    return Array.from(s).sort().reverse();
  }, [teams]);
  const seasonTeams = useMemo(() => sortTeams((teams ?? []).filter((t) => t.season === season)), [teams, season]);
  const team = seasonTeams.find((t) => t.id === teamId) ?? null;

  useEffect(() => {
    setPhaseId('');
    if (!team) { setPhases(null); return; }
    let alive = true;
    setPhases(null);
    loadPhases(team.id).then((p) => alive && setPhases(p)).catch((e) => alive && setError(e.message || String(e)));
    return () => { alive = false; };
  }, [team?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = useMemo(() => phaseLabels(phases ?? []), [phases]);
  const phase = (phases ?? []).find((p) => p.id === phaseId) ?? null;
  const counts = results ? {
    ok: results.filter((r) => r.status === 'ok').length,
    skip: results.filter((r) => r.status === 'ignoree').length,
    err: results.filter((r) => r.status === 'erreur').length,
  } : null;

  return (
    <div className="space-y-4">
      {/* --- Chargement depuis le cache FFBB -------------------------------------------------- */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-amber-500">Équipes du club · saison {currentSeason()}</h2>
            <p className="text-[11px] text-slate-400">
              {cacheInfo ? `Cache FFBB : ${cacheInfo.n} poule(s), dernière mise à jour ${fmtDateTimeLocal(cacheInfo.last)}.` : 'Lecture du cache FFBB…'}
            </p>
          </div>
          <button onClick={loadFromCache} disabled={running} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-amber-500 disabled:opacity-60">
            {running ? `Chargement ${progress.done}/${progress.total}…` : '⬇ Charger les équipes depuis le cache'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          Le site de la FFBB bloque les serveurs : le cache est rempli par <a href={EXE_URL} className="font-bold text-amber-400 underline">MiseAJourFFBB_Club.exe</a> (à lancer depuis un PC).
          Ce bouton lit ensuite le cache, détecte les équipes du club pour la saison en cours et enregistre leurs phases, calendriers et classements.
        </p>
        {running && <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-amber-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>}
        {syncError && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-300 break-words">{syncError}</p>}
        {results && counts && (
          <details className="rounded-lg bg-slate-800/60 p-2 text-xs text-slate-300" open={counts.err > 0}>
            <summary className="cursor-pointer font-bold">{counts.ok} poule(s) chargée(s) · {counts.skip} ignorée(s) · {counts.err} en erreur</summary>
            <ul className="mt-2 space-y-1 max-h-48 overflow-auto">
              {results.map((r) => (
                <li key={r.pouleId} className={r.status === 'erreur' ? 'text-rose-300' : r.status === 'ignoree' ? 'text-slate-500' : 'text-emerald-300'}>
                  {r.status === 'ok' ? '✓' : r.status === 'ignoree' ? '–' : '✕'} poule {r.pouleId} : {r.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 break-words">{error}. Vérifiez que sql/admin_01_club_calendar.sql a été exécuté.</p>}

      {/* --- Équipes (une vignette par équipe) ----------------------------------------------- */}
      <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-amber-500">Équipes</h2>
          <label className="flex items-center gap-2 text-xs text-slate-400">Saison
            <select value={season} onChange={(e) => { setSeason(e.target.value); setTeamId(''); }} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm font-bold text-white">
              {seasons.map((s) => <option key={s} value={s}>{s}{s === currentSeason() ? ' (en cours)' : ''}</option>)}
            </select>
          </label>
        </div>
        {!teams ? <p className="py-4 text-center text-sm text-slate-400">Chargement…</p>
          : seasonTeams.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Aucune équipe pour cette saison. Utilisez « Charger les équipes depuis le cache ».</p>
          : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {seasonTeams.map((t) => (
                <TeamTile key={t.id} team={t} selected={t.id === teamId} onClick={() => setTeamId(t.id === teamId ? '' : t.id)}
                  badge={`${phaseCounts[t.id] || 0} phase${(phaseCounts[t.id] || 0) > 1 ? 's' : ''}`} />
              ))}
            </div>
          )}
      </section>

      {/* --- Phases de l'équipe choisie ------------------------------------------------------ */}
      {team && (
        <section className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-3 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-extrabold text-white">{team.label} <span className="font-normal text-slate-400">· {team.season}</span></h2>
            <p className="text-[11px] text-slate-500">Équipe TeamStats liée : {team.stats_team_id ? 'oui' : 'non'} · mise à jour {fmtDateTimeLocal(team.last_sync_at)}</p>
          </div>
          <ImageEditor team={team} onSaved={refreshTeams} />
          {!phases ? <p className="py-3 text-center text-sm text-slate-400">Chargement…</p>
            : phases.length === 0 ? <p className="py-3 text-center text-sm text-slate-400">Aucune phase.</p>
            : (
              <ul className="space-y-2">
                {phases.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setPhaseId(p.id === phaseId ? '' : p.id)}
                      className={`w-full rounded-xl border p-3 text-left transition ${p.id === phaseId ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'}`}>
                      <p className="text-sm text-white">
                        <span className="font-black text-amber-400">{labels.get(p.id)} :</span>{' '}
                        {p.competition_url
                          ? <a href={p.competition_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-bold underline decoration-slate-500 hover:text-amber-300">{p.competition_name || 'Compétition'}</a>
                          : <span className="font-bold">{p.competition_name || 'Compétition'}</span>}
                        {p.poule_label ? <span className="text-slate-300"> - {/^poule/i.test(p.poule_label) ? p.poule_label.replace(/^Poule/, 'poule') : `poule ${p.poule_label}`}</span> : null}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        n° de phase FFBB {p.competition_id || '—'} · n° de poule {p.poule_id} · {p.matches_count} match(s) · {fmtDay(p.starts_on)} → {fmtDay(p.ends_on)}
                      </p>
                      <p className="text-[11px] text-slate-600">{p.our_team_name || ''}{p.cache_fetched_at ? ` · cache du ${fmtDateTimeLocal(p.cache_fetched_at)}` : ''}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {phase && (
            <div className="border-t border-slate-800 pt-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{labels.get(phase.id)} · calendrier</p>
              <ClubCalendar phase={phase} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Image de l'équipe : normalement lue dans les données FFBB ; ce champ permet de la corriger à la main
// (coller l'adresse de l'image api.ffbb.com/assets/… ou son identifiant).
function ImageEditor({ team, onSaved }: { team: ClubTeam; onSaved: () => void | Promise<void> }) {
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { setValue(''); setMsg(''); }, [team.id]);
  const save = async () => {
    const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(value);
    if (!m) { setMsg('Identifiant d\'image introuvable dans ce texte.'); return; }
    const { error } = await supabase.from('stats_club_teams').update({ logo_asset: m[0] }).eq('id', team.id);
    if (error) { setMsg(error.message); return; }
    setMsg('Image enregistrée.'); setValue(''); await onSaved();
  };
  return (
    <details className="text-xs text-slate-400">
      <summary className="cursor-pointer font-semibold">Changer l&apos;image de l&apos;équipe</summary>
      <div className="mt-2 flex gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://api.ffbb.com/assets/9d89f3b3-…" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:border-amber-500 focus:outline-none" />
        <button onClick={save} disabled={!value.trim()} className="shrink-0 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white disabled:opacity-40">Enregistrer</button>
      </div>
      {msg && <p className="mt-1 text-[11px] text-slate-300">{msg}</p>}
    </details>
  );
}
