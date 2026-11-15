// Lecture du trombinoscope PDF de l'extranet FFBB (« ARA0069106_U11_FILLES_1.pdf »).
// Le PDF est lu DANS LE NAVIGATEUR (il pèse plusieurs Mo à cause des photos : inutile et risqué de l'envoyer au
// serveur). On ne garde que : nom, prénom, n° de licence, date de naissance, sexe + infos de licence. Les photos
// ne sont jamais lues ni enregistrées.
import { normName } from './clubTeams';

export interface PdfItem { str: string; x: number; y: number }

export interface ParsedPlayer {
  firstName: string;
  lastName: string;
  licenceNumber: string;
  licenceDate: string | null; // AAAA-MM-JJ
  birthdate: string | null; // AAAA-MM-JJ
  sexe: 'F' | 'M' | null;
  nationality: string | null;
  licenceType: string | null; // « 0C »
  licenceCategory: string | null; // « U11 », « Seniors »
  insurance: string | null; // « N - Pas d'assurance »
  extra: string | null; // ligne supplémentaire (ex. « D11 »)
}
export interface ParsedRoster {
  teamLabel: string | null; // « U11 FILLES »
  teamNumber: number | null;
  club: string | null;
  season: string | null; // « 2026-2027 »
  players: ParsedPlayer[];
}

// --- lecture brute du PDF (navigateur) : liste de pages, chacune une liste de textes positionnés -------------
export async function extractPdfPages(data: ArrayBuffer): Promise<PdfItem[][]> {
  // @ts-ignore : le build « legacy » de pdf.js n'a pas de typage propre
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'; // copie de pdfjs-dist/legacy/build (public/)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push((tc.items as any[]).filter((it) => typeof it.str === 'string' && it.str.trim()).map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] })));
  }
  return pages;
}

const iso = (d: string | undefined) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const RE_LICENCE = /^([A-Z]{1,3}\d{4,9})\s*-\s*(\d{2}\/\d{2}\/\d{4})$/;
const RE_BIRTH = /^(\d{2}\/\d{2}\/\d{4})\s*-\s*(Féminin|Masculin)(?:\s*-\s*(.+))?$/i;
const RE_RIGHT_LICENCE = /^Licence\s+(\S+)\s*-\s*(.+)$/i;
const RE_INSURANCE = /^[A-Z]\+?\s*-\s*\S/;

// --- analyse pure (testable sans navigateur) ------------------------------------------------------------------
export function parseTrombinoscope(pages: PdfItem[][]): ParsedRoster {
  const out: ParsedRoster = { teamLabel: null, teamNumber: null, club: null, season: null, players: [] };

  for (const items of pages) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i].str;
      let m: RegExpExecArray | null;
      if (!out.teamLabel && (m = /^Nom de l['’]équipe\s*:\s*(.*)$/i.exec(s))) out.teamLabel = m[1].trim() || null;
      if (out.teamNumber === null && (m = /^Num[ée]ro\s*:\s*(\d+)/i.exec(s))) out.teamNumber = parseInt(m[1], 10);
      if (!out.club && (m = /^Nom du Club\s*:\s*(.*)$/i.exec(s))) out.club = m[1].trim() || null;
      if (!out.season && (m = /^(\d{4})\s*-\s*(\d{4})$/.exec(s))) out.season = `${m[1]}-${m[2]}`;
    }
  }

  for (const items of pages) {
    const heads = items.filter((it) => /^Généralités$/i.test(it.str)).sort((a, b) => b.y - a.y);
    const sportif = items.filter((it) => /^Sportif$/i.test(it.str));
    // frontière entre la colonne « Généralités » (gauche) et « Sportif » (droite)
    const boundary = sportif.length ? Math.min(...sportif.map((s) => s.x)) - 15 : 380;

    heads.forEach((h, idx) => {
      const top = h.y + 6;
      const bottom = idx + 1 < heads.length ? heads[idx + 1].y + 6 : -Infinity;
      const inBlock = items.filter((it) => it.y <= top && it.y > bottom && !/^(Généralités|Sportif)$/i.test(it.str));
      const sortLines = (arr: PdfItem[]) => [...arr].sort((a, b) => b.y - a.y || a.x - b.x).map((it) => it.str);
      const left = sortLines(inBlock.filter((it) => it.x < boundary));
      const right = sortLines(inBlock.filter((it) => it.x >= boundary));

      const p: ParsedPlayer = {
        firstName: '', lastName: '', licenceNumber: '', licenceDate: null, birthdate: null, sexe: null, nationality: null,
        licenceType: null, licenceCategory: null, insurance: null, extra: null,
      };
      const extras: string[] = [];
      for (const line of left) {
        let m: RegExpExecArray | null;
        if ((m = RE_LICENCE.exec(line))) { p.licenceNumber = m[1]; p.licenceDate = iso(m[2]); }
        else if ((m = RE_BIRTH.exec(line))) { p.birthdate = iso(m[1]); p.sexe = /^f/i.test(m[2]) ? 'F' : 'M'; p.nationality = m[3]?.trim() || null; }
        else if (/^[A-Z]{2,4}\d{5,}\s*-\s*/.test(line)) { /* ligne du club : ignorée */ }
        else if (!p.lastName && line.includes(' - ')) {
          const k = line.indexOf(' - ');
          p.firstName = line.slice(0, k).trim();
          p.lastName = line.slice(k + 3).trim();
        } else extras.push(line);
      }
      for (const line of right) {
        let m: RegExpExecArray | null;
        if ((m = RE_RIGHT_LICENCE.exec(line))) { p.licenceType = m[1]; p.licenceCategory = m[2].trim(); }
        else if (RE_INSURANCE.test(line)) p.insurance = line;
        else if (!/^\d{1,3}$/.test(line)) extras.push(line);
      }
      p.extra = extras.length ? extras.join(' · ') : null;
      if (p.licenceNumber && p.lastName) out.players.push(p);
    });
  }
  return out;
}

// --- rattachement à une équipe du club ---------------------------------------------------------------------------
export interface TeamLite { id: string; season: string; code: string; category: string | null; sexe: 'F' | 'M' | 'X' | null; team_number: number | null }

// « U11 FILLES » + n° 1 -> « U11F » ; « U13 GARCONS » + n° 2 -> « U13M-2 ». null si l'équipe n'est pas renseignée / lisible.
export function teamCodeFromPdf(label: string | null, numero: number | null): string | null {
  const t = normName(label);
  if (!t) return null;
  const sx = /FILLE|FEMININ|\bF\b/.test(t) ? 'F' : /GARCON|MASCULIN|\bM\b/.test(t) ? 'M' : '';
  const u = /\bU\s?(\d{1,2})\b/.exec(t);
  const cat = u ? `U${parseInt(u[1], 10)}` : /SENIOR|\bSEN\b/.test(t) ? 'SEN' : null;
  if (!cat) return null;
  return `${cat}${sx}${numero && numero > 1 ? `-${numero}` : ''}`;
}

export const seasonEndYear = (season: string) => parseInt(season.split('-')[1], 10);
// Âge sportif = année de fin de saison - année de naissance (2026-2027 : né en 2016 -> 11 ans -> U11).
export const sportAge = (birthdate: string | null, season: string): number | null => {
  const y = parseInt((birthdate || '').slice(0, 4), 10);
  return Number.isFinite(y) ? seasonEndYear(season) - y : null;
};

// Équipe d'après la date de naissance (équipe non renseignée dans le PDF) : à sexe égal, la plus petite catégorie
// Uxx dont le nombre est >= à l'âge sportif (10 ou 11 ans -> U11, 12-13 -> U13...), sinon Seniors à partir de 19 ans.
export function teamByBirthdate(birthdate: string | null, sexe: 'F' | 'M' | null, season: string, teams: TeamLite[]): TeamLite | null {
  const age = sportAge(birthdate, season);
  if (age === null) return null;
  const pool = teams.filter((t) => t.season === season && (!sexe || t.sexe === sexe || t.sexe === 'X' || t.sexe === null));
  const rank = (t: TeamLite) => [t.sexe === sexe ? 0 : 1, t.team_number ?? 1];
  const best = (arr: TeamLite[]) => [...arr].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; })[0] ?? null;
  if (age >= 19) {
    const sen = best(pool.filter((t) => t.category === 'Seniors'));
    if (sen) return sen;
  }
  const young = pool.map((t) => ({ t, n: /^U(\d+)$/.exec(t.category || '') })).filter((x): x is { t: TeamLite; n: RegExpExecArray } => !!x.n)
    .map((x) => ({ t: x.t, n: parseInt(x.n[1], 10) })).filter((x) => x.n >= age);
  if (young.length === 0) return null;
  const minN = Math.min(...young.map((x) => x.n));
  return best(young.filter((x) => x.n === minN).map((x) => x.t));
}

// Surclassement : la fiche porte « D11 » = joueuse jouant en U11 alors que sa catégorie d'âge est plus jeune (U9).
export function surclassementOf(extra: string | null | undefined): string | null {
  const m = /(?:^|\s|·)D(\d{1,2})(?:\s|·|$)/.exec(extra || '');
  return m ? `U${parseInt(m[1], 10)}` : null;
}

// Adulte (>= 19 ans) dans une équipe de jeunes : encadrement (entraîneur, parent...) et non joueur.
export function guessRole(birthdate: string | null, season: string, team: TeamLite | null): 'joueur' | 'encadrement' {
  const age = sportAge(birthdate, season);
  return age !== null && age >= 19 && team?.category !== 'Seniors' ? 'encadrement' : 'joueur';
}
