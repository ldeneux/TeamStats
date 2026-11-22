// Accès base (côté navigateur, RLS appliquée) aux équipes du club, phases, matchs et classements.
import { supabase } from './supabase';
import { cupBaseName, cupTourNumber, isCup } from './clubTeams';

export interface ClubTeam {
  id: string; season: string; code: string; label: string; category: string | null; sexe: 'F' | 'M' | 'X' | null;
  team_number: number | null; logo_asset: string | null; stats_team_id: string | null; last_sync_at: string | null;
}
export interface ClubPhase {
  id: string; club_team_id: string; phase_number: number; competition_id: string | null; competition_name: string | null;
  competition_code: string | null; competition_url: string | null; poule_id: string; poule_label: string | null;
  engagement_id: string | null; our_team_name: string | null; logo_asset: string | null; starts_on: string | null;
  ends_on: string | null; matches_count: number; cache_fetched_at: string | null; last_sync_at: string;
  // Coupe seulement (calculé à l'affichage, pas en base) : les tours d'une même coupe sont regroupés en UNE entrée.
  groupIds?: string[];
  tours?: { phaseId: string; tour: number; name: string; competition_id: string | null; poule_id: string; matches_count: number; starts_on: string | null; ends_on: string | null }[];
}
export interface ClubMatch {
  id: string; phase_id: string; ffbb_rencontre_id: string; numero_journee: string | null; match_date: string | null;
  status: 'a_venir' | 'joue';
  team1_name: string | null; team1_score: number | null; team1_logo_asset: string | null; team1_engagement_id: string | null;
  team2_name: string | null; team2_score: number | null; team2_logo_asset: string | null; team2_engagement_id: string | null;
  us_is_team1: boolean | null; location: string | null;
}
export interface ClubStanding {
  id: string; engagement_id: string; engagement_nom: string | null; position: number | null; points: number | null;
  matches_joues: number | null; gagnes: number | null; perdus: number | null; is_us: boolean;
}

const CAT_ORDER = (c: string | null) => {
  const m = /^U(\d+)$/.exec(c || '');
  return m ? parseInt(m[1], 10) : c === 'Seniors' ? 100 : 200;
};
export const sortTeams = (teams: ClubTeam[]) =>
  [...teams].sort(
    (a, b) =>
      CAT_ORDER(a.category) - CAT_ORDER(b.category) ||
      String(a.sexe).localeCompare(String(b.sexe)) ||
      (a.team_number ?? 0) - (b.team_number ?? 0)
  );

export async function loadClubTeams(): Promise<ClubTeam[]> {
  const { data, error } = await supabase.from('stats_club_teams').select('*').order('season', { ascending: false });
  if (error) throw new Error(error.message);
  const teams = (data ?? []) as ClubTeam[];
  // Équipe sans image propre : on reprend celle d'une de ses phases (le logo de la compétition).
  if (teams.some((t) => !t.logo_asset)) {
    const { data: ph } = await supabase.from('stats_club_phases').select('club_team_id, logo_asset').not('logo_asset', 'is', null);
    const byTeam = new Map<string, string>();
    for (const p of (ph ?? []) as { club_team_id: string; logo_asset: string }[]) if (!byTeam.has(p.club_team_id)) byTeam.set(p.club_team_id, p.logo_asset);
    for (const t of teams) if (!t.logo_asset) t.logo_asset = byTeam.get(t.id) ?? null;
  }
  return teams;
}
export async function loadPhases(clubTeamId: string): Promise<ClubPhase[]> {
  const { data, error } = await supabase.from('stats_club_phases').select('*').eq('club_team_id', clubTeamId);
  if (error) throw new Error(error.message);
  return mergeCupPhases((data ?? []) as ClubPhase[]);
}

// Une coupe se joue en plusieurs TOURS, chacun étant une « phase » FFBB distincte (« 2ème tour Coupe du Rhône… »). On les regroupe en une seule
// entrée « Coupe du Rhône… - poule A » ; ses matchs sont rangés par tour (1er tour, 2e tour…). Les phases de championnat restent séparées.
export function mergeCupPhases(phases: ClubPhase[]): ClubPhase[] {
  const out: ClubPhase[] = [];
  const groups = new Map<string, ClubPhase[]>();
  for (const p of phases) {
    if (!isCup(p.competition_name)) { out.push(p); continue; }
    const key = cupBaseName(p.competition_name).toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  for (const list of Array.from(groups.values())) {
    const sorted = [...list].sort((a, b) => cupTourNumber(a.competition_name) - cupTourNumber(b.competition_name) || String(a.starts_on ?? '').localeCompare(String(b.starts_on ?? '')));
    // Tours numérotés : leur numéro si tous distincts, sinon l'ordre d'arrivée. Phases finales (1/8, 1/4…) : leur rang propre (≥ 100), jamais renumérotées.
    const numbered = sorted.filter((x) => cupTourNumber(x.competition_name) < 100);
    const numDistinct = new Set(numbered.map((x) => cupTourNumber(x.competition_name))).size === numbered.length;
    const tours = sorted.map((p) => ({
      phaseId: p.id, tour: cupTourNumber(p.competition_name) >= 100 ? cupTourNumber(p.competition_name) : numDistinct ? cupTourNumber(p.competition_name) : numbered.indexOf(p) + 1,
      name: p.competition_name || '', competition_id: p.competition_id, poule_id: p.poule_id, matches_count: p.matches_count, starts_on: p.starts_on, ends_on: p.ends_on,
    }));
    const starts = sorted.map((p) => p.starts_on).filter(Boolean).sort() as string[];
    const ends = sorted.map((p) => p.ends_on).filter(Boolean).sort() as string[];
    out.push({
      ...sorted[0], competition_name: cupBaseName(sorted[0].competition_name),
      starts_on: starts[0] ?? null, ends_on: ends[ends.length - 1] ?? null,
      matches_count: sorted.reduce((n, p) => n + p.matches_count, 0), groupIds: sorted.map((p) => p.id), tours,
    });
  }
  return sortPhases(out);
}

// Contenu d'une phase ; pour une coupe regroupée : les matchs de tous ses tours, avec le TOUR comme numéro de journée.
export async function loadPhaseContent(phase: ClubPhase): Promise<{ matches: ClubMatch[]; standings: ClubStanding[] }> {
  const ids = phase.groupIds ?? [phase.id];
  const [m, s] = await Promise.all([
    supabase.from('stats_club_matches').select('*').in('phase_id', ids).order('match_date', { ascending: true }),
    supabase.from('stats_club_standings').select('*').in('phase_id', ids),
  ]);
  if (m.error) throw new Error(m.error.message);
  if (s.error) throw new Error(s.error.message);
  let matches = (m.data ?? []) as ClubMatch[];
  let standings = (s.data ?? []) as (ClubStanding & { phase_id?: string })[];
  if (phase.tours) {
    const tourOf = new Map(phase.tours.map((t) => [t.phaseId, t.tour]));
    matches = matches.map((x) => ({ ...x, numero_journee: String(tourOf.get(x.phase_id) ?? 1) }));
    const lastPhase = phase.tours[phase.tours.length - 1].phaseId;                 // classement : celui du dernier tour
    standings = standings.filter((x) => x.phase_id === lastPhase);
  }
  return { matches, standings };
}

export const sortPhases = (phases: ClubPhase[]) =>
  [...phases].sort(
    (a, b) => String(a.starts_on ?? '9999').localeCompare(String(b.starts_on ?? '9999')) || a.phase_number - b.phase_number
  );

// « Phase 1 », « Phase 2 »... (numérotées dans l'ordre chronologique) ; les coupes sont nommées « Coupe ».
// Le numéro vient du libellé FFBB (phase_number > 0). Sans libellé (0) : une phase seule qui démarre après le 31 octobre est la phase 2
// (ex. une équipe créée en phase 2) ; sinon on numérote dans l'ordre chronologique.
export function phaseLabels(phases: ClubPhase[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = sortPhases(phases);
  const champ = sorted.filter((p) => !isCup(p.competition_name));
  const used = new Set(champ.filter((p) => p.phase_number > 0).map((p) => p.phase_number));
  const unknown = champ.filter((p) => !(p.phase_number > 0));
  const afterOctober = (d: string | null) => !!d && /^\d{4}-(1[12]|0[1-8])/.test(d);   // novembre à août
  let next = 1;
  for (const p of sorted) {
    if (isCup(p.competition_name)) { out.set(p.id, 'Coupe'); continue; }
    if (p.phase_number > 0) { out.set(p.id, `Phase ${p.phase_number}`); continue; }
    if (unknown.length === 1 && used.size === 0) { out.set(p.id, afterOctober(p.starts_on) ? 'Phase 2' : 'Phase 1'); continue; }
    while (used.has(next)) next++;
    used.add(next);
    out.set(p.id, `Phase ${next}`);
  }
  return out;
}

// Phase « en cours » : celle dont les dates (à une semaine près) couvrent aujourd'hui — la plus récemment
// commencée si plusieurs ; sinon la prochaine à venir ; sinon la dernière.
export function defaultPhase(phases: ClubPhase[], today = new Date()): ClubPhase | null {
  if (phases.length === 0) return null;
  const sorted = sortPhases(phases);
  const t = today.getTime();
  const DAY = 86400000;
  const covering = sorted.filter((p) => {
    if (!p.starts_on || !p.ends_on) return false;
    return t >= Date.parse(p.starts_on) - 7 * DAY && t <= Date.parse(p.ends_on) + 8 * DAY;
  });
  const champ = covering.filter((p) => !isCup(p.competition_name));
  if (covering.length > 0) return (champ.length > 0 ? champ : covering)[(champ.length > 0 ? champ : covering).length - 1];
  const next = sorted.find((p) => p.starts_on && Date.parse(p.starts_on) > t);
  return next ?? sorted[sorted.length - 1];
}

// Les heures sont enregistrées « telles quelles » (heure de Paris) et étiquetées UTC : on les relit en UTC.
export const fmtShortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '';
export const fmtDay = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export const fmtDateTimeLocal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
