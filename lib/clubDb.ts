// Accès base (côté navigateur, RLS appliquée) aux équipes du club, phases, matchs et classements.
import { supabase } from './supabase';
import { isCup } from './clubTeams';

export interface ClubTeam {
  id: string; season: string; code: string; label: string; category: string | null; sexe: 'F' | 'M' | 'X' | null;
  team_number: number | null; logo_asset: string | null; stats_team_id: string | null; last_sync_at: string | null;
}
export interface ClubPhase {
  id: string; club_team_id: string; phase_number: number; competition_id: string | null; competition_name: string | null;
  competition_code: string | null; competition_url: string | null; poule_id: string; poule_label: string | null;
  engagement_id: string | null; our_team_name: string | null; logo_asset: string | null; starts_on: string | null;
  ends_on: string | null; matches_count: number; cache_fetched_at: string | null; last_sync_at: string;
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
  return (data ?? []) as ClubTeam[];
}
export async function loadPhases(clubTeamId: string): Promise<ClubPhase[]> {
  const { data, error } = await supabase.from('stats_club_phases').select('*').eq('club_team_id', clubTeamId);
  if (error) throw new Error(error.message);
  return sortPhases((data ?? []) as ClubPhase[]);
}
export async function loadPhaseContent(phaseId: string): Promise<{ matches: ClubMatch[]; standings: ClubStanding[] }> {
  const [m, s] = await Promise.all([
    supabase.from('stats_club_matches').select('*').eq('phase_id', phaseId).order('match_date', { ascending: true }),
    supabase.from('stats_club_standings').select('*').eq('phase_id', phaseId),
  ]);
  if (m.error) throw new Error(m.error.message);
  if (s.error) throw new Error(s.error.message);
  return { matches: (m.data ?? []) as ClubMatch[], standings: (s.data ?? []) as ClubStanding[] };
}

export const sortPhases = (phases: ClubPhase[]) =>
  [...phases].sort(
    (a, b) => String(a.starts_on ?? '9999').localeCompare(String(b.starts_on ?? '9999')) || a.phase_number - b.phase_number
  );

// « Phase 1 », « Phase 2 »... (numérotées dans l'ordre chronologique) ; les coupes sont nommées « Coupe ».
export function phaseLabels(phases: ClubPhase[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const p of sortPhases(phases)) out.set(p.id, isCup(p.competition_name) ? 'Coupe' : `Phase ${++n}`);
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
