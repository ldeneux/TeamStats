// Renforts : joueuses d'une AUTRE équipe du club ajoutées à la feuille de match.
//
// Règles (validées avec le club) : à partir de l'équipe qui joue (ex. « U15 F équipe 1 »), on peut prendre des joueuses
//  - d'une équipe du MÊME sexe : de la catégorie juste en dessous, de la même catégorie (autre numéro d'équipe) ou de la catégorie juste au-dessus
//    (U15 F : U13 F, U15 F, U18 F) ; « juste en dessous / au-dessus » = les catégories qui existent dans le club cette saison ;
//  - d'une équipe de l'AUTRE sexe : seulement en U9 et U11 (mixité), et uniquement de la même catégorie (U11 F : U11 M).
// Exemple U11 F : U11 F (équipe 2), U9 F, U11 M, U13 F.
import { supabase } from './supabase';

export interface RenfortPlayer { id: string; name: string; number: number }
export interface RenfortTeam {
  clubTeamId: string; code: string; label: string; category: string | null; sexe: 'F' | 'M' | 'X' | null;
  teamNumber: number | null; logoAsset: string | null; isTarget: boolean; statsTeamId: string; players: RenfortPlayer[];
}

const catNum = (c: string | null) => { const m = /^U(\d+)$/.exec(c || ''); return m ? parseInt(m[1], 10) : c === 'Seniors' ? 100 : null; };
const MIXED_LEVELS = [9, 11];

// Équipes dont on peut prendre des renforts (sans l'équipe elle-même), selon les règles ci-dessus.
export function allowedSources(target: RenfortTeam, all: RenfortTeam[]): RenfortTeam[] {
  const tn = catNum(target.category);
  if (tn === null) return [];
  const ladder = Array.from(new Set(all.map((t) => catNum(t.category)).filter((n): n is number => n !== null))).sort((a, b) => a - b);
  const i = ladder.indexOf(tn);
  const near = new Set([ladder[i - 1], tn, ladder[i + 1]].filter((n): n is number => n !== undefined));
  return all.filter((t) => {
    if (t.clubTeamId === target.clubTeamId) return false;
    const n = catNum(t.category);
    if (n === null) return false;
    const sameSex = !target.sexe || !t.sexe || target.sexe === 'X' || t.sexe === 'X' || target.sexe === t.sexe;
    if (sameSex) return near.has(n);
    return n === tn && MIXED_LEVELS.includes(tn);              // mixité : U9 et U11, même catégorie seulement
  });
}

// Charge les équipes du club (même saison que l'équipe TeamStats `targetStatsTeamId`) avec leurs joueuses.
// Passe par une fonction de la base : un coach n'a pas accès aux autres équipes, mais ne reçoit que nom et numéro.
export async function loadRenfortTeams(targetStatsTeamId: string): Promise<RenfortTeam[]> {
  const { data, error } = await supabase.rpc('renfort_candidates', { p_target_team: targetStatsTeamId });
  if (error) throw new Error(error.message);
  const byTeam = new Map<string, RenfortTeam>();
  for (const r of (data ?? []) as any[]) {
    let t = byTeam.get(r.club_team_id);
    if (!t) {
      t = { clubTeamId: r.club_team_id, code: r.code, label: r.label, category: r.category, sexe: r.sexe, teamNumber: r.team_number,
            logoAsset: r.logo_asset, isTarget: !!r.is_target, statsTeamId: r.stats_team_id, players: [] };
      byTeam.set(r.club_team_id, t);
    }
    if (r.player_id) t.players.push({ id: r.player_id, name: r.player_name, number: r.player_number ?? 0 });
  }
  return Array.from(byTeam.values());
}

// Provenance enregistrée avec le nom dans les statistiques d'un match : « Léa MARTIN (U13F) ».
export const withFrom = (name: string, from?: string) => (from ? `${name} (${from})` : name);
export function splitFrom(stored: string): { name: string; from?: string } {
  const m = /^(.*\S)\s+\(([^()]+)\)$/.exec(stored || '');
  return m ? { name: m[1], from: m[2] } : { name: stored };
}
