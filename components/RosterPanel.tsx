'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ClubTeam, sortTeams } from '../lib/clubDb';
import { currentSeason } from '../lib/clubTeams';
import {
  ParsedPlayer, ParsedRoster, extractPdfPages, guessRole, parseTrombinoscope, sportAge, surclassementOf, teamByBirthdate, teamCodeFromPdf,
} from '../lib/rosterPdf';

interface RosterRow {
  id: string; club_team_id: string; licence_number: string; first_name: string; last_name: string; birthdate: string | null;
  sexe: 'F' | 'M' | null; licence_type: string | null; licence_category: string | null; extra: string | null; role: 'joueur' | 'encadrement';
}
interface PreviewItem { p: ParsedPlayer; teamId: string; role: 'joueur' | 'encadrement'; include: boolean }
interface Preview { parsed: ParsedRoster; season: string; headerTeamId: string | null; warn: string; items: PreviewItem[]; fileName: string }

const frDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Badge « Surclassée U11 » (fiche FFBB : D11).
function SurclassBadge({ extra }: { extra: string | null; sexe?: 'F' | 'M' | null }) {
  const u = surclassementOf(extra);
  if (!u) return null;
  return <span className="ml-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 align-middle text-[9px] font-black uppercase text-amber-300">Surclassement {u}</span>;
}
const withoutSurclass = (extra: string | null) => (surclassementOf(extra) ? (extra || '').replace(/(^|\s|·)D\d{1,2}(?=\s|·|$)/, '').replace(/^\s*·\s*|\s*·\s*$/g, '').trim() || null : extra);
const selCls = 'rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-bold text-white focus:border-amber-500 focus:outline-none';

// Effectif d'une équipe : liste + import du trombinoscope PDF de l'extranet FFBB.
export default function RosterPanel({ team, allTeams, onChanged }: { team: ClubTeam; allTeams: ClubTeam[]; onChanged: () => void | Promise<void> }) {
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState('');
  const [removeMissing, setRemoveMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const seasonTeams = useMemo(() => sortTeams(allTeams.filter((t) => t.season === team.season)), [allTeams, team.season]);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('stats_club_roster').select('*').eq('club_team_id', team.id).order('last_name').order('first_name');
    if (e) { setError(`${e.message}. Vérifiez que sql/admin_03_roster.sql a été exécuté.`); setRows([]); return; }
    setError(''); setRows((data ?? []) as RosterRow[]);
  }, [team.id]);
  useEffect(() => { setRows(null); setNotice(''); setPreview(null); void load(); }, [load]);

  // --- lecture du PDF + affectation -----------------------------------------------------------------------
  const onFile = async (file: File) => {
    setBusy('Lecture du PDF…'); setError(''); setNotice(''); setPreview(null);
    try {
      const parsed = parseTrombinoscope(await extractPdfPages(await file.arrayBuffer()));
      if (parsed.players.length === 0) throw new Error('Aucun joueur reconnu : est-ce bien un trombinoscope de l\'extranet FFBB ?');
      const season = parsed.season || currentSeason();
      const teams = allTeams.filter((t) => t.season === season);
      const code = teamCodeFromPdf(parsed.teamLabel, parsed.teamNumber);
      const headerTeam = code ? teams.find((t) => t.code === code) ?? null : null;
      let warn = '';
      if (teams.length === 0) warn = `Aucune équipe n'existe pour la saison ${season} : chargez d'abord les équipes depuis le cache FFBB.`;
      else if (code && !headerTeam) warn = `L'équipe du PDF (« ${parsed.teamLabel} », ${code}) n'existe pas pour ${season} : les joueurs sont répartis d'après leur date de naissance.`;
      else if (!code) warn = 'Équipe non renseignée dans le PDF : les joueurs sont répartis d\'après leur date de naissance.';
      const items = parsed.players.map((p) => {
        const t = headerTeam ?? teamByBirthdate(p.birthdate, p.sexe, season, teams);
        return { p, teamId: t?.id ?? '', role: guessRole(p.birthdate, season, t), include: !!t } as PreviewItem;
      });
      setPreview({ parsed, season, headerTeamId: headerTeam?.id ?? null, warn, items, fileName: file.name });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(''); if (fileRef.current) fileRef.current.value = '';
    }
  };

  const setItem = (i: number, patch: Partial<PreviewItem>) =>
    setPreview((pv) => (pv ? { ...pv, items: pv.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) } : pv));

  const doImport = async () => {
    if (!preview) return;
    const chosen = preview.items.filter((it) => it.include && it.teamId);
    if (chosen.length === 0) return;
    setBusy('Enregistrement…'); setError('');
    try {
      const payload = chosen.map(({ p, teamId, role }) => ({
        club_team_id: teamId, licence_number: p.licenceNumber, first_name: p.firstName, last_name: p.lastName, birthdate: p.birthdate,
        sexe: p.sexe, nationality: p.nationality, licence_type: p.licenceType, licence_category: p.licenceCategory,
        licence_date: p.licenceDate, insurance: p.insurance, extra: p.extra, role, updated_at: new Date().toISOString(),
      }));
      for (let i = 0; i < payload.length; i += 100) {
        const { error: e } = await supabase.from('stats_club_roster').upsert(payload.slice(i, i + 100), { onConflict: 'club_team_id,licence_number' });
        if (e) throw new Error(e.message);
      }
      let removed = 0;
      if (removeMissing && preview.headerTeamId) {
        const keep = new Set(chosen.filter((c) => c.teamId === preview.headerTeamId).map((c) => c.p.licenceNumber));
        const { data: existing } = await supabase.from('stats_club_roster').select('id, licence_number').eq('club_team_id', preview.headerTeamId);
        const gone = ((existing ?? []) as { id: string; licence_number: string }[]).filter((r) => !keep.has(r.licence_number)).map((r) => r.id);
        if (gone.length > 0) {
          const { error: e } = await supabase.from('stats_club_roster').delete().in('id', gone);
          if (e) throw new Error(e.message);
          removed = gone.length;
        }
      }
      const byTeam = new Map<string, number>();
      for (const c of chosen) byTeam.set(c.teamId, (byTeam.get(c.teamId) ?? 0) + 1);
      const detail = Array.from(byTeam.entries()).map(([id, n]) => `${allTeams.find((t) => t.id === id)?.label ?? '?'} : ${n}`).join(' · ');
      setNotice(`${chosen.length} personne(s) enregistrée(s) (${detail})${removed ? `, ${removed} retirée(s) de l'équipe` : ''}.`);
      setPreview(null);
      await load(); await onChanged();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setBusy(''); }
  };

  // --- actions sur la liste ---------------------------------------------------------------------------------
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError('');
    const { error: e } = await fn();
    if (e) { setError(e.message); return; }
    await load(); await onChanged();
  };
  const players = (rows ?? []).filter((r) => r.role === 'joueur');
  const staff = (rows ?? []).filter((r) => r.role === 'encadrement');

  const Row = ({ r }: { r: RosterRow }) => {
    const age = sportAge(r.birthdate, team.season);
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-800/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white"><span className="font-extrabold">{r.last_name}</span> {r.first_name}<SurclassBadge extra={r.extra} sexe={r.sexe} /></p>
          <p className="text-[11px] text-slate-500">
            {r.licence_number} · né{r.sexe === 'F' ? 'e' : ''} le {frDate(r.birthdate)}{age !== null ? ` (${age} ans)` : ''}
            {r.licence_category ? ` · licence ${r.licence_category}` : ''}{withoutSurclass(r.extra) ? ` · ${withoutSurclass(r.extra)}` : ''}
          </p>
        </div>
        <select value={team.id} onChange={(e) => run(() => supabase.from('stats_club_roster').update({ club_team_id: e.target.value }).eq('id', r.id))} className={selCls} title="Changer d'équipe">
          {seasonTeams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button onClick={() => run(() => supabase.from('stats_club_roster').update({ role: r.role === 'joueur' ? 'encadrement' : 'joueur' }).eq('id', r.id))} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] font-bold text-slate-300" title="Changer le rôle">
          {r.role === 'joueur' ? '→ encadrement' : '→ joueur'}
        </button>
        <button onClick={() => { if (window.confirm(`Retirer ${r.first_name} ${r.last_name} de l'équipe ?`)) void run(() => supabase.from('stats_club_roster').delete().eq('id', r.id)); }} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] font-bold text-rose-300" title="Retirer de l'équipe">✕</button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {rows === null ? 'Chargement…' : `${players.length} joueur(s)${staff.length ? ` · ${staff.length} encadrement` : ''}`} · saison {team.season}
        </p>
        <label className="cursor-pointer rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500">
          📄 Importer un PDF extranet FFBB
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        </label>
      </div>
      {busy && <p className="text-xs text-amber-400">{busy}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-300 break-words">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-300">{notice}</p>}

      {preview && (
        <div className="space-y-3 rounded-xl border border-amber-500/50 bg-slate-800/40 p-3">
          <div>
            <p className="text-sm font-extrabold text-white">Aperçu : {preview.parsed.teamLabel || 'équipe non renseignée'}{preview.parsed.teamNumber ? ` · n° ${preview.parsed.teamNumber}` : ''} · {preview.season}</p>
            <p className="text-[11px] text-slate-500">{preview.fileName} · {preview.items.length} personne(s) lue(s) (photos ignorées)</p>
          </div>
          {preview.warn && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">{preview.warn}</p>}
          <ul className="space-y-1.5">
            {preview.items.map((it, i) => {
              const age = sportAge(it.p.birthdate, preview.season);
              return (
                <li key={it.p.licenceNumber} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 ${it.include ? 'bg-slate-900/70' : 'bg-slate-900/30 opacity-60'}`}>
                  <input type="checkbox" checked={it.include} disabled={!it.teamId} onChange={(e) => setItem(i, { include: e.target.checked })} className="h-4 w-4 accent-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white"><span className="font-extrabold">{it.p.lastName}</span> {it.p.firstName}<SurclassBadge extra={it.p.extra} sexe={it.p.sexe} /></p>
                    <p className="text-[11px] text-slate-500">{it.p.licenceNumber} · {frDate(it.p.birthdate)}{age !== null ? ` (${age} ans)` : ''} · {it.p.sexe === 'F' ? 'F' : it.p.sexe === 'M' ? 'M' : '?'}{it.p.licenceCategory ? ` · ${it.p.licenceCategory}` : ''}{withoutSurclass(it.p.extra) ? ` · ${withoutSurclass(it.p.extra)}` : ''}</p>
                  </div>
                  <select value={it.teamId} onChange={(e) => setItem(i, { teamId: e.target.value, include: !!e.target.value, role: guessRole(it.p.birthdate, preview.season, allTeams.find((t) => t.id === e.target.value) ?? null) })} className={`${selCls} ${it.teamId ? '' : 'border-rose-500'}`}>
                    <option value="">— à affecter —</option>
                    {sortTeams(allTeams.filter((t) => t.season === preview.season)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <select value={it.role} onChange={(e) => setItem(i, { role: e.target.value as PreviewItem['role'] })} className={selCls}>
                    <option value="joueur">joueur</option><option value="encadrement">encadrement</option>
                  </select>
                </li>
              );
            })}
          </ul>
          {preview.headerTeamId && (
            <label className="flex items-start gap-2 text-[11px] text-slate-400">
              <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
              Retirer de l&apos;équipe « {allTeams.find((t) => t.id === preview.headerTeamId)?.label} » les personnes absentes de ce PDF
            </label>
          )}
          <div className="flex gap-2">
            <button onClick={() => setPreview(null)} className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white">Annuler</button>
            <button onClick={doImport} disabled={!!busy || preview.items.every((it) => !it.include || !it.teamId)} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-40">
              Importer {preview.items.filter((it) => it.include && it.teamId).length} personne(s)
            </button>
          </div>
        </div>
      )}

      {rows && rows.length === 0 && !preview && <p className="rounded-xl bg-slate-800/50 p-4 text-center text-sm text-slate-400">Aucun effectif pour cette équipe. Importez le PDF de l&apos;extranet FFBB.</p>}
      {players.length > 0 && (<><h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-300">Effectif ({players.length})</h3><ul className="space-y-1.5">{players.map((r) => <Row key={r.id} r={r} />)}</ul></>)}
      {staff.length > 0 && (<><h3 className="pt-1 text-xs font-extrabold uppercase tracking-wide text-slate-300">Encadrement ({staff.length})</h3><ul className="space-y-1.5">{staff.map((r) => <Row key={r.id} r={r} />)}</ul></>)}
    </div>
  );
}
