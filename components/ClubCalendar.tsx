'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ClubMatch, ClubPhase, ClubStanding, fmtShortDate, fmtTime, loadPhaseContent,
} from '../lib/clubDb';
import { ffbbAssetUrl } from '../lib/clubTeams';
import { supabase } from '../lib/supabase';
import { useStatsPdf } from '../lib/statsPdfContext';

// ---------------------------------------------------------------------------------------
// Petits éléments d'affichage partagés
// ---------------------------------------------------------------------------------------
const initials = (name: string | null) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Crest({ asset, name, size = 8 }: { asset: string | null; name: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const url = ffbbAssetUrl(asset, { width: 64 });
  const px = size === 8 ? 'w-8 h-8' : 'w-6 h-6';
  if (!url || broken) {
    return <span className={`${px} shrink-0 rounded-full bg-slate-700 text-[10px] font-bold text-slate-300 flex items-center justify-center`}>{initials(name)}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className={`${px} shrink-0 rounded-full bg-white/90 object-contain`} />;
}

const isExempt = (n: string | null) => !n || n.trim().toLowerCase() === 'exempt';
const journeeLabel = (j: string) => (Number.isNaN(Number(j)) ? j : `${j}${j === '1' ? 're' : 'e'} journée`);

function journeeOptions(matches: ClubMatch[]): string[] {
  const set = new Set<string>();
  for (const m of matches) if (m.numero_journee) set.add(m.numero_journee);
  return Array.from(set).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
  });
}
// Journée proposée par défaut : la prochaine où il reste un match à jouer, sinon la dernière.
function defaultJournee(matches: ClubMatch[], options: string[]): string | null {
  const next = options.find((j) => matches.some((m) => m.numero_journee === j && m.status === 'a_venir'));
  return next ?? options[options.length - 1] ?? null;
}

// Icône « statistiques » : visible seulement si des stats ont été saisies pour ce match ; un clic télécharge le PDF.
interface StatsHook { ids: Set<string>; busyId: string; onOpen: (m: ClubMatch) => void }

function MatchCard({ m, stats }: { m: ClubMatch; stats?: StatsHook }) {
  const hasStats = !!stats && stats.ids.has(m.ffbb_rencontre_id);
  const busy = !!stats && stats.busyId === m.ffbb_rencontre_id;
  const played = m.status === 'joue';
  const usLeft = m.us_is_team1 === true;
  const usRight = m.us_is_team1 === false;
  const leftEx = isExempt(m.team1_name), rightEx = isExempt(m.team2_name);
  const bye = leftEx || rightEx;
  const ls = bye ? null : m.team1_score, rs = bye ? null : m.team2_score;
  let lc = 'text-white', rc = 'text-white';
  if (m.us_is_team1 !== null && played && ls != null && rs != null) {
    const us = usLeft ? ls : rs, them = usLeft ? rs : ls;
    const c = us > them ? 'text-blue-400' : us < them ? 'text-rose-400' : 'text-emerald-400';
    if (usLeft) lc = c; else rc = c;
  }
  const nameCls = (ex: boolean, us: boolean) => (ex ? 'font-semibold uppercase tracking-wide text-slate-500' : us ? 'font-bold text-amber-400' : 'text-slate-300');
  return (
    <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-2.5">
      <div className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-right text-sm ${nameCls(leftEx, usLeft)}`} title={m.team1_name || ''}>{leftEx ? 'EXEMPT' : m.team1_name}</span>
        {leftEx ? <span className="w-8 h-8 shrink-0" /> : <Crest asset={m.team1_logo_asset} name={m.team1_name} />}
        <span className="flex w-20 shrink-0 flex-col items-center leading-tight">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{fmtShortDate(m.match_date)}</span>
          {bye ? <span className="text-sm text-slate-600">–</span>
            : played ? (
              <span className="whitespace-nowrap text-lg font-black">
                <span className={lc}>{ls ?? '–'}</span><span className="text-slate-500"> - </span><span className={rc}>{rs ?? '–'}</span>
              </span>
            ) : <span className="text-sm font-bold text-slate-300">{fmtTime(m.match_date) || '?'}</span>}
          {hasStats && (
            <button
              type="button"
              onClick={() => stats?.onOpen(m)}
              disabled={busy}
              title="Statistiques du match (PDF)"
              aria-label="Télécharger le PDF des statistiques du match"
              className="mt-1 flex h-7 w-9 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/15 text-base leading-none transition hover:bg-amber-500/30 disabled:opacity-60"
            >{busy ? '⏳' : '📊'}</button>
          )}
        </span>
        {rightEx ? <span className="w-8 h-8 shrink-0" /> : <Crest asset={m.team2_logo_asset} name={m.team2_name} />}
        <span className={`min-w-0 flex-1 truncate text-sm ${nameCls(rightEx, usRight)}`} title={m.team2_name || ''}>{rightEx ? 'EXEMPT' : m.team2_name}</span>
      </div>
      {m.location && !bye && !played && m.us_is_team1 !== null && (
        <p className="mt-1 text-center text-[10px] text-slate-500 truncate">📍 {m.location}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Calendrier & résultats
// ---------------------------------------------------------------------------------------
function CalendrierTab({ matches, stats }: { matches: ClubMatch[]; stats?: StatsHook }) {
  const [scope, setScope] = useState<'us' | 'poule'>('us');
  const [mode, setMode] = useState<'une' | 'toutes'>('toutes');
  const scoped = useMemo(() => (scope === 'poule' ? matches : matches.filter((m) => m.us_is_team1 !== null)), [matches, scope]);
  const options = useMemo(() => journeeOptions(scoped), [scoped]);
  const [picked, setPicked] = useState<string | null>(null);
  const journee = picked && options.includes(picked) ? picked : defaultJournee(scoped, options);
  const idx = journee ? options.indexOf(journee) : -1;
  const undated = scoped.filter((m) => !m.numero_journee);
  const sortByDate = (a: ClubMatch, b: ClubMatch) => String(a.match_date ?? '').localeCompare(String(b.match_date ?? ''));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-xs">
          {([['us', 'Notre équipe'], ['poule', 'Toute la poule']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)} className={`px-3 py-1.5 font-semibold ${scope === k ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex overflow-hidden rounded-full border border-slate-700 bg-slate-800 text-xs">
          {([['une', 'Une journée'], ['toutes', 'Toutes']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`px-3 py-1.5 font-semibold ${mode === k ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="font-semibold">Notre score :</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400" />Victoire</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />Nul</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-rose-400" />Défaite</span>
      </div>

      {scoped.length === 0 && <p className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 text-center text-sm text-slate-400">Aucun match pour cette phase.</p>}

      {mode === 'une' && options.length > 0 && (
        <div className="flex items-center justify-center gap-3">
          <button disabled={idx <= 0} onClick={() => setPicked(options[idx - 1])} className="w-9 h-9 rounded-lg bg-slate-800 text-lg font-bold text-white disabled:opacity-30">‹</button>
          <span className="min-w-[8rem] text-center text-sm font-black uppercase tracking-tight text-amber-400">{journee ? journeeLabel(journee) : ''}</span>
          <button disabled={idx < 0 || idx >= options.length - 1} onClick={() => setPicked(options[idx + 1])} className="w-9 h-9 rounded-lg bg-slate-800 text-lg font-bold text-white disabled:opacity-30">›</button>
        </div>
      )}

      {mode === 'toutes'
        ? options.map((j) => (
            <div key={j}>
              <p className="mb-1.5 rounded bg-slate-800/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{journeeLabel(j)}</p>
              <div className="space-y-2">{scoped.filter((m) => m.numero_journee === j).sort(sortByDate).map((m) => <MatchCard key={m.id} m={m} stats={stats} />)}</div>
            </div>
          ))
        : (
          <div className="space-y-2">
            {journee && scoped.filter((m) => m.numero_journee === journee).sort(sortByDate).map((m) => <MatchCard key={m.id} m={m} stats={stats} />)}
          </div>
        )}

      {undated.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Matchs sans journée renseignée</p>
          <div className="space-y-2">{undated.sort(sortByDate).map((m) => <MatchCard key={m.id} m={m} stats={stats} />)}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Classement (officiel FFBB s'il est dans la page, sinon calculé depuis les résultats)
// ---------------------------------------------------------------------------------------
interface Row { s: ClubStanding; bp: number; bc: number; last: string[]; logo: string | null }

function computeStandings(matches: ClubMatch[], ourEngagement: string | null): ClubStanding[] {
  const t = new Map<string, ClubStanding>();
  const get = (id: string, nom: string | null) => {
    let r = t.get(id);
    if (!r) { r = { id, engagement_id: id, engagement_nom: nom, position: null, points: 0, matches_joues: 0, gagnes: 0, perdus: 0, is_us: id === ourEngagement }; t.set(id, r); }
    return r;
  };
  const diff = new Map<string, number>();
  for (const m of matches) {
    if (m.status !== 'joue' || m.team1_score == null || m.team2_score == null || !m.team1_engagement_id || !m.team2_engagement_id) continue;
    const a = get(m.team1_engagement_id, m.team1_name), b = get(m.team2_engagement_id, m.team2_name);
    a.matches_joues = (a.matches_joues ?? 0) + 1; b.matches_joues = (b.matches_joues ?? 0) + 1;
    diff.set(a.engagement_id, (diff.get(a.engagement_id) ?? 0) + m.team1_score - m.team2_score);
    diff.set(b.engagement_id, (diff.get(b.engagement_id) ?? 0) + m.team2_score - m.team1_score);
    if (m.team1_score === m.team2_score) { a.points = (a.points ?? 0) + 1; b.points = (b.points ?? 0) + 1; continue; }
    const [w, l] = m.team1_score > m.team2_score ? [a, b] : [b, a];
    w.gagnes = (w.gagnes ?? 0) + 1; w.points = (w.points ?? 0) + 2; // victoire 2 pts
    l.perdus = (l.perdus ?? 0) + 1; l.points = (l.points ?? 0) + 1; // défaite 1 pt
  }
  const rows = Array.from(t.values()).sort((x, y) => (y.points ?? 0) - (x.points ?? 0) || (diff.get(y.engagement_id) ?? 0) - (diff.get(x.engagement_id) ?? 0));
  rows.forEach((r, i) => { r.position = i + 1; });
  return rows;
}

function ClassementTab({ standings, matches, ourEngagement }: { standings: ClubStanding[]; matches: ClubMatch[]; ourEngagement: string | null }) {
  const official = standings.length > 0;
  const list = official ? standings : computeStandings(matches, ourEngagement);
  const played = matches.filter((m) => m.status === 'joue' && m.team1_score != null && m.team2_score != null);
  const rows: Row[] = list.slice().sort((a, b) => (a.position ?? 999) - (b.position ?? 999)).map((s) => {
    const mine = played.filter((m) => m.team1_engagement_id === s.engagement_id || m.team2_engagement_id === s.engagement_id)
      .sort((a, b) => String(a.match_date).localeCompare(String(b.match_date)));
    let bp = 0, bc = 0;
    const last: string[] = [];
    for (const m of mine) {
      const t1 = m.team1_engagement_id === s.engagement_id;
      const f = (t1 ? m.team1_score : m.team2_score) ?? 0, c = (t1 ? m.team2_score : m.team1_score) ?? 0;
      bp += f; bc += c; last.push(f > c ? 'V' : f < c ? 'D' : 'N');
    }
    const any = matches.find((m) => m.team1_engagement_id === s.engagement_id || m.team2_engagement_id === s.engagement_id);
    const logo = any ? (any.team1_engagement_id === s.engagement_id ? any.team1_logo_asset : any.team2_logo_asset) : null;
    return { s, bp, bc, last: last.slice(-5), logo };
  });
  if (rows.length === 0) return <p className="rounded-xl bg-slate-900/80 border border-slate-800 p-5 text-center text-sm text-slate-400">Pas de classement pour cette phase (aucun match joué).</p>;
  const hasDraws = list.some((c) => (c.matches_joues ?? 0) - (c.gagnes ?? 0) - (c.perdus ?? 0) > 0);
  return (
    <div className="space-y-2">
      {!official && <p className="text-[11px] text-slate-500">Classement calculé à partir des résultats (victoire 2 pts, défaite 1 pt) : le classement officiel n&apos;était pas dans les données FFBB.</p>}
      <div className="overflow-x-auto rounded-xl bg-slate-900/80 border border-slate-800">
        <table className="w-full min-w-[680px] whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Équipe</th>
              <th className="px-2 py-2 text-right">Pts</th><th className="px-2 py-2 text-right">J</th>
              <th className="px-2 py-2 text-right">{hasDraws ? 'G-N-P' : 'G-P'}</th>
              <th className="px-2 py-2 text-right">BP</th><th className="px-2 py-2 text-right">BC</th>
              <th className="px-2 py-2 text-right">Diff</th><th className="px-2 py-2">Forme</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, bp, bc, last, logo }) => {
              const d = bp - bc;
              return (
                <tr key={s.engagement_id} className={`border-b border-slate-800/60 last:border-0 ${s.is_us ? 'bg-amber-500/10 font-bold text-amber-300' : 'text-slate-200'}`}>
                  <td className="px-3 py-2">{s.position ?? '—'}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2 whitespace-normal"><Crest asset={logo} name={s.engagement_nom} /><span>{s.engagement_nom ?? 'Équipe inconnue'}</span></div></td>
                  <td className="px-2 py-2 text-right font-black">{s.points ?? '—'}</td>
                  <td className="px-2 py-2 text-right text-slate-400">{s.matches_joues ?? '—'}</td>
                  <td className="px-2 py-2 text-right">{hasDraws ? `${s.gagnes ?? '—'}-${(s.matches_joues ?? 0) - (s.gagnes ?? 0) - (s.perdus ?? 0)}-${s.perdus ?? '—'}` : `${s.gagnes ?? '—'}-${s.perdus ?? '—'}`}</td>
                  <td className="px-2 py-2 text-right text-slate-400">{bp || '—'}</td>
                  <td className="px-2 py-2 text-right text-slate-400">{bc || '—'}</td>
                  <td className={`px-2 py-2 text-right font-semibold ${d > 0 ? 'text-blue-400' : d < 0 ? 'text-rose-400' : 'text-slate-400'}`}>{d > 0 ? '+' : ''}{d}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      {last.length === 0 ? <span className="text-slate-600">—</span> : last.map((r, i) => (
                        <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${r === 'V' ? 'bg-blue-500' : r === 'N' ? 'bg-slate-500' : 'bg-rose-500'}`}>{r}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Bloc complet pour UNE phase : onglets « Calendrier & résultats » / « Classement »
// ---------------------------------------------------------------------------------------
export default function ClubCalendar({ phase }: { phase: ClubPhase }) {
  const [tab, setTab] = useState<'calendrier' | 'classement'>('calendrier');
  const [data, setData] = useState<{ matches: ClubMatch[]; standings: ClubStanding[] } | null>(null);
  const [error, setError] = useState('');
  const pdfApi = useStatsPdf();
  const [statsIds, setStatsIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState('');
  const [pdfError, setPdfError] = useState('');

  // Quels matchs de la phase ont des statistiques saisies ? (la RLS ne renvoie que ceux auxquels on a accès)
  useEffect(() => {
    setStatsIds(new Set());
    if (!pdfApi || !data) return;
    const ids = data.matches.filter((m) => m.us_is_team1 !== null).map((m) => m.ffbb_rencontre_id);
    if (ids.length === 0) return;
    let alive = true;
    (async () => {
      const found = new Set<string>();
      for (let i = 0; i < ids.length; i += 60) {
        const { data: rows } = await supabase.from('stats_matches').select('ffbb_match_id').in('ffbb_match_id', ids.slice(i, i + 60));
        for (const r of (rows ?? []) as { ffbb_match_id: string }[]) found.add(String(r.ffbb_match_id));
      }
      if (alive) setStatsIds(found);
    })().catch(() => undefined); // sans réseau : simplement pas d'icône
    return () => { alive = false; };
  }, [data, pdfApi]);

  const openStatsPdf = async (m: ClubMatch) => {
    if (!pdfApi || busyId) return;
    setBusyId(m.ffbb_rencontre_id); setPdfError('');
    try {
      await pdfApi.exportMatchStats(m.ffbb_rencontre_id, m.us_is_team1);
    } catch (e: any) {
      setPdfError(e?.message || 'Échec de la génération du PDF.');
    } finally { setBusyId(''); }
  };
  const statsHook: StatsHook | undefined = pdfApi ? { ids: statsIds, busyId, onOpen: openStatsPdf } : undefined;

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    loadPhaseContent(phase.id).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(e.message || String(e)); });
    return () => { alive = false; };
  }, [phase.id]);

  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border border-slate-700 bg-slate-800 p-1 text-sm font-bold">
        {([['calendrier', '📅 Calendrier & résultats'], ['classement', '🏆 Classement']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg px-3 py-2 transition ${tab === k ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>{l}</button>
        ))}
      </div>
      {error && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 break-words">Lecture impossible : {error}</p>}
      {pdfError && <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300 break-words">PDF impossible : {pdfError}</p>}
      {!data && !error && <p className="py-6 text-center text-sm text-slate-400">Chargement…</p>}
      {data && (tab === 'calendrier'
        ? <CalendrierTab matches={data.matches} stats={statsHook} />
        : <ClassementTab standings={data.standings} matches={data.matches} ourEngagement={phase.engagement_id} />)}
    </div>
  );
}
