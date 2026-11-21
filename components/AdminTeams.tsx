'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClubCalendar from './ClubCalendar';
import TeamTile from './TeamTile';
import RosterPanel from './RosterPanel';
import { adminApi } from '../lib/adminApi';
import { supabase } from '../lib/supabase';
import { ClubPhase, ClubTeam, fmtDateTimeLocal, fmtDay, loadClubTeams, loadPhases, mergeCupPhases, phaseLabels, sortTeams } from '../lib/clubDb';
import { currentSeason, displayCompetitionName, ffbbAssetUrl, tourLabel } from '../lib/clubTeams';
import { isLockedSeason, useLockedBefore } from '../lib/seasonLock';

// Programme à lancer depuis un PC pour (re)charger le cache FFBB (même fichier que dans l'appli Multisports).
const EXE_URL = process.env.NEXT_PUBLIC_FFBB_EXE_URL || 'https://multisports-eosin.vercel.app/MiseAJourFFBB_Club.exe';

interface PouleResult { pouleId: string; status: 'ok' | 'ignoree' | 'erreur'; message: string; teams: string[]; matches: number }
const BATCH = 3;

export default function AdminTeams() {
  const lockedBefore = useLockedBefore();
  const [teams, setTeams] = useState<ClubTeam[] | null>(null);
  const [error, setError] = useState('');
  const [season, setSeason] = useState(currentSeason());
  const [teamId, setTeamId] = useState('');
  const [phases, setPhases] = useState<ClubPhase[] | null>(null);
  const [phaseId, setPhaseId] = useState('');
  const [teamView, setTeamView] = useState<'EFFECTIF' | 'PHASES'>('EFFECTIF');
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
      // Nombre de phases AFFICHÉES : les tours d'une même coupe comptent pour une seule phase (comme dans la liste des phases).
      const { data } = await supabase.from('stats_club_phases').select('*');
      const byTeam = new Map<string, ClubPhase[]>();
      for (const r of (data ?? []) as ClubPhase[]) byTeam.set(r.club_team_id, [...(byTeam.get(r.club_team_id) ?? []), r]);
      const c: Record<string, number> = {};
      byTeam.forEach((list, id) => { c[id] = mergeCupPhases(list).length; });
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
              {seasons.map((s) => <option key={s} value={s}>{s}{s === currentSeason() ? ' (en cours)' : isLockedSeason(s, lockedBefore) ? ' 🔒 historique' : ''}</option>)}
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
          <ImageEditor team={team} pouleIds={(phases ?? []).map((p) => p.poule_id)} onSaved={refreshTeams} />
          <div className="flex rounded-xl border border-slate-700 bg-slate-800 p-1 text-sm font-bold">
            {([['EFFECTIF', '👥 Effectif'], ['PHASES', '🗓 Phases & calendrier']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTeamView(k)} className={`flex-1 rounded-lg px-3 py-2 transition ${teamView === k ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
          {teamView === 'EFFECTIF' && <RosterPanel team={team} allTeams={teams ?? []} onChanged={refreshTeams} />}
          {teamView === 'PHASES' && (<>
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
                          ? <a href={p.competition_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-bold underline decoration-slate-500 hover:text-amber-300">{displayCompetitionName(p.competition_name, p.competition_code)}</a>
                          : <span className="font-bold">{displayCompetitionName(p.competition_name, p.competition_code)}</span>}
                        {p.poule_label ? <span className="text-slate-300"> - {/^poule/i.test(p.poule_label) ? p.poule_label.replace(/^Poule/, 'poule') : `poule ${p.poule_label}`}</span> : null}
                      </p>
                      {p.tours ? p.tours.map((t) => (
                        <p key={t.phaseId} className="mt-1 text-[11px] text-slate-500">
                          <span className="font-bold text-slate-400">{tourLabel(t.tour)}</span> : n° de phase FFBB {t.competition_id || '—'} · n° de poule {t.poule_id} · {t.matches_count} match(s) · {fmtDay(t.starts_on)} → {fmtDay(t.ends_on)}
                        </p>
                      )) : (
                        <p className="mt-1 text-[11px] text-slate-500">
                          n° de phase FFBB {p.competition_id || '—'} · n° de poule {p.poule_id} · {p.matches_count} match(s) · {fmtDay(p.starts_on)} → {fmtDay(p.ends_on)}
                        </p>
                      )}
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
          </>)}
        </section>
      )}
    </div>
  );
}

// Image de l'équipe : normalement lue dans les données FFBB. Si elle manque, « Chercher » liste les images
// présentes dans les pages FFBB de l'équipe (avec miniature) : un clic choisit la bonne.
// On peut aussi coller l'adresse api.ffbb.com/assets/… (ou l'identifiant) à la main.
interface AssetCandidate { id: string; score: number; count: number; paths: string[]; labels: string[] }
function ImageEditor({ team, pouleIds, onSaved }: { team: ClubTeam; pouleIds: string[]; onSaved: () => void | Promise<void> }) {
  const locked = isLockedSeason(team.season, useLockedBefore());
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<AssetCandidate[] | null>(null);
  useEffect(() => { setValue(''); setMsg(''); setCands(null); }, [team.id]);

  const saveId = async (id: string) => {
    const { error } = await supabase.from('stats_club_teams').update({ logo_asset: id }).eq('id', team.id);
    if (error) { setMsg(error.message); return; }
    setMsg('Image enregistrée.'); setValue(''); setCands(null); await onSaved();
  };
  const saveTyped = () => {
    const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(value);
    if (!m) { setMsg('Identifiant d\'image introuvable dans ce texte.'); return; }
    void saveId(m[0]);
  };
  const search = async () => {
    setBusy(true); setMsg(''); setCands(null);
    try {
      const r = await adminApi<{ candidates: AssetCandidate[] }>('/api/admin/club-sync', 'POST', { action: 'assets', pouleIds: pouleIds.slice(0, 4) });
      setCands(r.candidates);
      if (r.candidates.length === 0) setMsg('Aucune image trouvée dans les pages FFBB de cette équipe.');
    } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  };
  if (locked) return null; // saison clôturée : lecture seule
  return (
    <details className="text-xs text-slate-400" open={!team.logo_asset}>
      <summary className="cursor-pointer font-semibold">{team.logo_asset ? "Changer l'image de l'équipe" : "⚠ Pas d'image : la retrouver"}</summary>
      <div className="mt-2 space-y-2">
        <button onClick={search} disabled={busy || pouleIds.length === 0} className="rounded-xl bg-slate-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy ? 'Recherche…' : '🔍 Chercher dans les données FFBB'}</button>
        {cands && cands.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {cands.map((c) => (
              <button key={c.id} onClick={() => saveId(c.id)} title={c.paths.join('\n')} className="rounded-xl border border-slate-700 bg-slate-800/70 p-1.5 text-center hover:border-amber-500">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ffbbAssetUrl(c.id, { height: 120 }) || ''} alt="" loading="lazy" className="mx-auto h-20 w-full rounded-lg bg-white object-contain" />
                <span className="mt-1 block truncate text-[9px] text-slate-500">{c.paths[0]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="ou coller https://api.ffbb.com/assets/9d89f3b3-…" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:border-amber-500 focus:outline-none" />
          <button onClick={saveTyped} disabled={!value.trim()} className="shrink-0 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white disabled:opacity-40">Enregistrer</button>
        </div>
        {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
      </div>
    </details>
  );
}
