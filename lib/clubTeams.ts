// Règles du club et lecture des équipes dans une poule FFBB (partagé serveur / client).
import type { FfbbPoule } from './ffbbPoule';

// Nom FFBB du club (les équipes s'appellent « OLYMPIC SATHONAY », « OLYMPIC SATHONAY - 2 »...)
// et nom court utilisé pour les équipes TeamStats (« SATHONAY U15F - 2026/2027 »).
export const CLUB_FFBB_NAME = 'OLYMPIC SATHONAY';
export const CLUB_SHORT_NAME = 'SATHONAY';
export const CLUB_COMITE_PATH = 'ligues/ara/comites/0069';

export const normName = (s: string | null | undefined) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// « OLYMPIC SATHONAY - 2 » -> { base: « OLYMPIC SATHONAY », numero: 2 }
export function splitTeamName(name: string | null | undefined) {
  const m = /^(.*?)\s*-\s*(\d+)\s*$/.exec((name || '').trim());
  return m ? { base: normName(m[1]), numero: parseInt(m[2], 10) } : { base: normName(name), numero: null as number | null };
}
export const isClubTeamName = (name: string | null | undefined) => splitTeamName(name).base === normName(CLUB_FFBB_NAME);

// Saison sportive (septembre -> août) d'une date : « 2026-2027 ».
export function seasonOfDate(d: Date): string {
  const end = d.getMonth() + 1 >= 9 ? d.getFullYear() + 1 : d.getFullYear();
  return `${end - 1}-${end}`;
}
export const currentSeason = () => seasonOfDate(new Date());
// Date FFBB (« 2026-09-20T14:00:00 », heure de Paris sans fuseau) -> saison.
export function seasonOfIso(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const end = parseInt(m[2], 10) >= 9 ? y + 1 : y;
  return `${end - 1}-${end}`;
}

export interface TeamIdentity {
  code: string; // « U15F », « U15F-2 », « SENM »
  label: string; // « U15 F », « U15 F · équipe 2 », « Seniors M »
  category: string; // « U15 », « Seniors »
  sexe: 'F' | 'M' | 'X';
  numero: number | null;
}

// Catégorie + sexe + numéro d'équipe, lus dans le nom de la compétition et le nom de l'équipe.
export function identifyTeam(competitionName: string | null, teamName: string | null): TeamIdentity {
  const comp = normName(competitionName);
  const um = /\bU\s?(\d{1,2})\b/.exec(comp);
  const category = um ? `U${parseInt(um[1], 10)}` : /SENIOR|SEN\b|REGIONALE|PRE.?REGIONALE|LOISIR/.test(comp) ? 'Seniors' : 'Autre';
  const sexe: 'F' | 'M' | 'X' = /FEMININ|FILLE|\bF\b/.test(comp) ? 'F' : /MASCULIN|GARCON|\bM\b/.test(comp) ? 'M' : 'X';
  const { numero } = splitTeamName(teamName);
  const catCode = category === 'Seniors' ? 'SEN' : category === 'Autre' ? 'AUT' : category;
  const sx = sexe === 'X' ? '' : sexe;
  return {
    code: `${catCode}${sx}${numero ? `-${numero}` : ''}`,
    label: `${category === 'Autre' ? 'Autre' : category}${sx ? ` ${sx}` : ''}${numero ? ` · équipe ${numero}` : ''}`,
    category,
    sexe,
    numero,
  };
}

// Numéro de phase EXPLICITE (« … - Phase 2 », « Phase 2 », « Saison régulière » = 1) ; 0 si le libellé n'en donne pas.
export function explicitPhaseNumber(label: string | null | undefined): number {
  const m = /phase\s*(\d+)/i.exec(label || '');
  if (m) return parseInt(m[1], 10);
  return /saison\s+r[ée]guli[eè]re/i.test(label || '') ? 1 : 0;
}
// Numéro de phase lu dans le nom de la compétition (« … - Phase 2 »), sinon 1.
export function phaseNumberOf(competitionName: string | null): number {
  const m = /phase\s*(\d+)/i.exec(competitionName || '');
  return m ? parseInt(m[1], 10) : 1;
}
// Nom de compétition à afficher : « Départementale féminine U15 - Phase 2 » devient « Départementale féminine U15 » (le numéro de
// phase est déjà donné par l'étiquette jaune « Phase 2 »). Si le nom n'indique pas la division mais que le code se termine par
// « -N » (ex. DFU13-3), on l'ajoute : « … - Division 3 ».
export function displayCompetitionName(name: string | null, code: string | null): string {
  let n = (name || '').replace(/\s*[-–]\s*(?:saison régulière|phase\s*\d+)\s*$/i, '').trim();
  if (!n) return 'Compétition';
  const div = /-(\d+)$/.exec(code || '');
  if (div && !/division|poule|niveau/i.test(n)) n = `${n} - Division ${div[1]}`;
  return n;
}
export const isCup = (competitionName: string | null) => /coupe|tour\b|challenge|trophee/i.test(competitionName || '');

// Nom de l'équipe TeamStats associée : « SATHONAY U15F - 2026/2027 ».
export const statsTeamName = (code: string, season: string) => `${CLUB_SHORT_NAME} ${code} - ${season.replace('-', '/')}`;

export const ffbbAssetUrl = (id: string | null | undefined, opts: { width?: number; height?: number } = {}) => {
  if (!id) return null;
  const qs = opts.height ? `?height=${opts.height}&fit=contain&format=avif` : opts.width ? `?width=${opts.width}` : '';
  return `https://api.ffbb.com/assets/${id}${qs}`;
};

// prefix : chemin lu dans la page (compétition de comité ou régionale) ; à défaut, le comité du club.
export const competitionUrl = (code: string | null, pouleId: string | null, competitionId: string | null, prefix: string | null = null) =>
  `https://competitions.ffbb.com${prefix || `/${CLUB_COMITE_PATH}`}/competitions/${code || competitionId || 'x'}` +
  `?poule=${pouleId ?? ''}${competitionId ? `&phase=${competitionId}` : ''}`;

export interface ClubEngagement {
  engagementId: string;
  teamName: string;
  isTeam1: boolean;
}
// Nos équipes (engagements) présentes dans une poule.
export function clubEngagementsIn(poule: FfbbPoule): ClubEngagement[] {
  const out = new Map<string, ClubEngagement>();
  for (const r of poule.rencontres) {
    if (r.engagement1 && isClubTeamName(r.nomEquipe1)) out.set(r.engagement1, { engagementId: r.engagement1, teamName: r.nomEquipe1 || '', isTeam1: true });
    if (r.engagement2 && isClubTeamName(r.nomEquipe2)) out.set(r.engagement2, { engagementId: r.engagement2, teamName: r.nomEquipe2 || '', isTeam1: false });
  }
  return Array.from(out.values());
}
