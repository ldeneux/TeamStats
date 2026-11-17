// Analyse des pages de poules FFBB déposées dans multisports.ffbb_poule_cache par MiseAJourFFBB_Club.exe.
// Port TypeScript de lib/ffbbPage.js (appli Multisports) : même lecture du JSON embarqué dans la page
// competitions.ffbb.com, avec en plus l'identifiant et le code de la compétition (la « phase »).
// Fonctions pures (aucun réseau) : utilisables côté serveur sur le contenu du cache.

export interface FfbbRencontre {
  id: string;
  numeroJournee: string | null;
  date_rencontre: string | null; // « 2026-09-20T14:00:00 » (heure de Paris telle quelle, étiquetée UTC)
  joue: boolean;
  resultatEquipe1: number | null;
  resultatEquipe2: number | null;
  nomEquipe1: string | null;
  nomEquipe2: string | null;
  engagement1: string | null;
  engagement2: string | null;
  logo1: string | null;
  logo2: string | null;
  organisme1: string | null;
  organisme2: string | null;
  salle: string | null;
}

export interface FfbbClassement {
  engagementId: string | null;
  nom: string | null;
  position: number | null;
  points: number | null;
  matchJoues: number | null;
  gagnes: number | null;
  perdus: number | null;
}

export interface FfbbPoule {
  pouleId: string;
  pouleNom: string | null;
  competitionId: string | null;
  competitionName: string | null;
  competitionCode: string | null;
  phaseLabel: string | null; // « Saison régulière », « Phase 2 » quand le site nomme ainsi la phase d'une compétition
  competitionPrefix: string | null; // « /ligues/ara/comites/0069 » (comité) ou « /ligues/ara » (compétition régionale)
  competitionLogoAsset: string | null;
  rencontres: FfbbRencontre[];
  classements: FfbbClassement[];
}

type Json = any; // JSON embarqué : structure libre, parcourue défensivement

const tryParse = (text: string): Json | undefined => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const unescapeHtml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Tous les blocs JSON exploitables du code source de la page.
export function jsonBlobs(html: string): Json[] {
  const blobs: Json[] = [];
  for (const m of Array.from(html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g))) {
    const parsed = tryParse(m[1]) ?? tryParse(unescapeHtml(m[1]));
    if (parsed !== undefined) blobs.push(parsed);
  }
  let flux = '';
  for (const m of Array.from(html.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g))) {
    const chunk = tryParse(m[1]);
    if (typeof chunk === 'string') flux += chunk;
  }
  for (const line of flux.split('\n')) {
    const m = line.match(/^[0-9a-f]+:(.*)$/);
    if (m) {
      const parsed = tryParse(m[1]);
      if (parsed !== undefined) blobs.push(parsed);
    }
  }
  return blobs;
}

// Parcours récursif ; `chain` = ancêtres (objets) du plus proche au plus lointain.
function walk(node: Json, chain: Json[], visit: (n: Json, c: Json[]) => void) {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, chain, visit);
    return;
  }
  if (node && typeof node === 'object') {
    visit(node, chain);
    const next = [node, ...chain];
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') walk(v, next, visit);
    }
  }
}

const isLongId = (v: unknown) => /^\d{9,}$/.test(String(v ?? ''));
const assetId = (x: Json): string | null => (typeof x === 'string' ? x : x && typeof x === 'object' ? x.id ?? null : null);
const toScore = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toInt = (v: unknown): number | null => {
  const n = toScore(v);
  return n === null ? null : Math.trunc(n);
};
const idOf = (v: Json): string | null => (v && typeof v === 'object' ? (v.id != null ? String(v.id) : null) : v != null ? String(v) : null);

function normRencontre(r: Json): FfbbRencontre {
  const e1 = r.idEngagementEquipe1 && typeof r.idEngagementEquipe1 === 'object' ? r.idEngagementEquipe1 : {};
  const e2 = r.idEngagementEquipe2 && typeof r.idEngagementEquipe2 === 'object' ? r.idEngagementEquipe2 : {};
  const logo = (e: Json) => assetId(e.idOrganisme?.logo) || assetId(e.logo);
  const carto = r.salle?.cartographie ?? {};
  const ville = carto.ville || r.salle?.commune?.libelle || null;
  const salleNom = r.salle?.libelle ?? carto.title ?? null;
  const joue = r.joue === true || r.joue === 'true' || r.joue === 1;
  return {
    id: String(r.id),
    numeroJournee: r.numeroJournee != null ? String(r.numeroJournee) : null,
    date_rencontre: typeof r.date_rencontre === 'string' && r.date_rencontre ? r.date_rencontre : null,
    joue,
    resultatEquipe1: joue ? toScore(r.resultatEquipe1) : null,
    resultatEquipe2: joue ? toScore(r.resultatEquipe2) : null,
    nomEquipe1: r.nomEquipe1 || null,
    nomEquipe2: r.nomEquipe2 || null,
    engagement1: e1.id != null ? String(e1.id) : null,
    engagement2: e2.id != null ? String(e2.id) : null,
    logo1: logo(e1),
    logo2: logo(e2),
    organisme1: e1.idOrganisme?.id != null ? String(e1.idOrganisme.id) : null,
    organisme2: e2.idOrganisme?.id != null ? String(e2.idOrganisme.id) : null,
    salle: [salleNom, ville].filter(Boolean).join(', ') || null,
  };
}

function normClassement(c: Json): FfbbClassement {
  const raw = c.idEngagement ?? c.engagement;
  const eng = raw && typeof raw === 'object' ? raw : { id: raw };
  return {
    engagementId: eng.id != null ? String(eng.id) : null,
    nom: eng.nom ?? c.nomEquipe ?? c.nom ?? null,
    position: toInt(c.position ?? c.rang ?? c.classement),
    points: toInt(c.points ?? c.pts),
    matchJoues: toInt(c.matchJoues ?? c.matchsJoues ?? c.nbMatchsJoues),
    gagnes: toInt(c.gagnes ?? c.nbGagnes ?? c.victoires),
    perdus: toInt(c.perdus ?? c.nbPerdus ?? c.defaites),
  };
}

// Extraction d'UNE page HTML de poule (pure, sans réseau).
export function extractPoule(html: string, pouleId: string): Omit<FfbbPoule, 'pouleId'> {
  const pid = String(pouleId);
  const rencontres = new Map<string, Json>();
  let pouleNode: Json = null;
  let pouleChain: Json[] = [];
  let pouleNom: string | null = null;

  for (const blob of jsonBlobs(html)) {
    walk(blob, [], (node, chain) => {
      if (String(node.id) === pid && (Array.isArray(node.rencontres) || Array.isArray(node.classements))) {
        const size = (node.rencontres?.length ?? 0) + (node.classements?.length ?? 0);
        const best = (pouleNode?.rencontres?.length ?? 0) + (pouleNode?.classements?.length ?? 0);
        if (!pouleNode || size > best) {
          pouleNode = node;
          pouleChain = chain;
        }
      }
      if (typeof node.nomEquipe1 === 'string' && typeof node.nomEquipe2 === 'string' && isLongId(node.id)) {
        const own = node.idPoule?.id;
        const belongs = own != null ? String(own) === pid : chain.some((a) => String(a.id) === pid && Array.isArray(a.rencontres));
        if (belongs) {
          if (own != null && node.idPoule?.nom && !pouleNom) pouleNom = node.idPoule.nom;
          if (!rencontres.has(String(node.id))) rencontres.set(String(node.id), node);
        }
      }
    });
  }

  // Compétition (= « phase » du site) : ancêtre de la fiche de la poule qui liste des poules.
  let competitionId: string | null = null;
  let competitionName: string | null = null;
  let competitionCode: string | null = null;
  let competitionPrefix: string | null = null;
  let phaseLabel: string | null = null;
  let competitionLogoAsset: string | null = null;
  for (const a of pouleChain) {
    if (Array.isArray(a.poules)) {
      if (!competitionName && a.nom) competitionName = a.nom;
      if (!competitionId && isLongId(a.id)) competitionId = String(a.id);
      if (!competitionCode && typeof a.code === 'string' && a.code && !/^\d+$/.test(a.code)) competitionCode = a.code;
    }
    if (!competitionLogoAsset) competitionLogoAsset = assetId(a.logo);
  }
  // Une compétition à plusieurs phases (ex. DFU13-3) : le nœud qui porte les poules s'appelle « Saison régulière » ou « Phase 2 » ;
  // le nom de la compétition est alors celui de son parent (celui qui liste les phases).
  if (competitionName && /^\s*(saison r[ée]guli[eè]re|phase\s*\d+)\s*$/i.test(competitionName)) {
    phaseLabel = competitionName;
    const parent = pouleChain.find((a) => Array.isArray(a.phases) && typeof a.nom === 'string' && a.nom);
    if (parent) {
      competitionName = parent.nom;
      if (typeof parent.code === 'string' && parent.code && !/^\d+$/.test(parent.code)) competitionCode = parent.code;
    }
  }
  // Libellé de phase porté par le nœud de la phase lui-même (« Phase 2 »), ou rang de la phase parmi celles de la compétition.
  if (!phaseLabel) {
    for (const a of pouleChain) {
      if (!Array.isArray(a.poules)) continue;
      for (const v of Object.values(a)) {
        if (typeof v === 'string' && /^\s*(saison r[ée]guli[eè]re|phase\s*\d+)\s*$/i.test(v)) { phaseLabel = v.trim(); break; }
      }
      if (phaseLabel) break;
    }
  }
  if (!phaseLabel && competitionId) {
    const parent = pouleChain.find((a) => Array.isArray(a.phases) && a.phases.length > 1);
    const idx = parent ? (parent.phases as Json[]).findIndex((ph) => String(ph?.id) === competitionId) : -1;
    if (idx >= 0) phaseLabel = `Phase ${idx + 1}`;
  }
  // Secours du logo : un objet « compétition » (id = celui de la phase) ou une rencontre qui le porte.
  if (!competitionLogoAsset) {
    for (const r of Array.from(rencontres.values())) {
      competitionLogoAsset = assetId(r.idCompetition?.logo) || assetId(r.competition?.logo) || competitionLogoAsset;
      if (competitionLogoAsset) break;
    }
  }
  if (!competitionLogoAsset && competitionId) {
    for (const blob of jsonBlobs(html)) {
      walk(blob, [], (node) => {
        if (!competitionLogoAsset && String(node.id) === competitionId && node.logo) competitionLogoAsset = assetId(node.logo);
      });
      if (competitionLogoAsset) break;
    }
  }
  // Secours : l'identifiant de compétition porté par une rencontre.
  if (!competitionId) {
    for (const r of Array.from(rencontres.values())) {
      const c = idOf(r.idCompetition ?? r.competition);
      if (c && isLongId(c)) {
        competitionId = c;
        break;
      }
    }
  }
  // Secours : le code lu dans un lien …/competitions/<code>?poule=<poule> présent dans la page.
  {
    const text = html.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
    // Le chemin du lien est gardé : une compétition régionale (RM2...) est sous /ligues/ara, pas sous le comité.
    const m = new RegExp(`((?:/ligues/[A-Za-z0-9_~%-]+)(?:/comites/[A-Za-z0-9_~%-]+)?)?/competitions/([A-Za-z0-9_.~%-]+)\\?[^"'\\\\\\s<>]*poule=${pid}`).exec(text);
    if (m && m[1]) competitionPrefix = m[1];
    if (m && !competitionCode && !/^\d{9,}$/.test(m[2])) competitionCode = m[2];
    if (!competitionId) {
      const p = new RegExp(`poule=${pid}[^"'\\\\\\s<>]*?phase=(\\d{9,})|phase=(\\d{9,})[^"'\\\\\\s<>]*?poule=${pid}`).exec(text);
      if (p) competitionId = p[1] || p[2] || null;
    }
  }

  if (!competitionLogoAsset) competitionLogoAsset = pickCompetitionLogo(html);

  return {
    pouleNom: pouleNode?.nom || pouleNom || null,
    competitionId,
    competitionName,
    competitionCode,
    competitionPrefix,
    phaseLabel,
    competitionLogoAsset,
    rencontres: Array.from(rencontres.values()).map(normRencontre),
    classements: ((pouleNode?.classements ?? []) as Json[]).map(normClassement),
  };
}

// Fusionne les pages (journées 1 et 2) déposées dans le cache sous la forme { pages: [html, ...] }.
export function pouleFromPages(pages: unknown, pouleId: string): FfbbPoule {
  const all = new Map<string, FfbbRencontre>();
  let meta: Omit<FfbbPoule, 'pouleId'> | null = null;
  for (const html of Array.isArray(pages) ? pages : []) {
    if (typeof html !== 'string' || !html) continue;
    const page = extractPoule(html, pouleId);
    if (!meta) meta = page;
    for (const r of page.rencontres) if (!all.has(r.id)) all.set(r.id, r);
    if (page.classements.length > meta.classements.length) meta.classements = page.classements;
    meta.pouleNom = meta.pouleNom || page.pouleNom;
    meta.competitionId = meta.competitionId || page.competitionId;
    meta.competitionName = meta.competitionName || page.competitionName;
    meta.competitionCode = meta.competitionCode || page.competitionCode;
    meta.competitionPrefix = meta.competitionPrefix || page.competitionPrefix;
    meta.phaseLabel = meta.phaseLabel || page.phaseLabel;
    meta.competitionLogoAsset = meta.competitionLogoAsset || page.competitionLogoAsset;
  }
  const rencontres = Array.from(all.values()).sort(
    (a, b) =>
      (Number(a.numeroJournee) || 0) - (Number(b.numeroJournee) || 0) ||
      String(a.date_rencontre ?? '').localeCompare(String(b.date_rencontre ?? ''))
  );
  return {
    pouleId: String(pouleId),
    pouleNom: meta?.pouleNom ?? null,
    competitionId: meta?.competitionId ?? null,
    competitionName: meta?.competitionName ?? null,
    competitionCode: meta?.competitionCode ?? null,
    competitionPrefix: meta?.competitionPrefix ?? null,
    phaseLabel: meta?.phaseLabel ?? null,
    competitionLogoAsset: meta?.competitionLogoAsset ?? null,
    rencontres,
    classements: meta?.classements ?? [],
  };
}


// ---------------------------------------------------------------------------------------
// Recherche d'images (assets api.ffbb.com) dans une page : sert à retrouver l'icône du niveau (U15 Dép. F...)
// quand sa position dans le JSON n'est pas celle attendue. Chaque asset est renvoyé avec son chemin JSON.
// ---------------------------------------------------------------------------------------
export interface AssetCandidate {
  id: string;
  score: number; // plus c'est haut, plus le chemin ressemble à « logo de la compétition »
  count: number;
  paths: string[];
  labels: string[];
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scorePath = (p: string) => {
  let s = 0;
  if (/ompetition|categor|division|phase|poule|championnat/i.test(p)) s += 2;
  if (/logo|image|icon|visuel|badge/i.test(p)) s += 1;
  if (/organisme|club|engagement|equipe|salle|commune|ligue|comite/i.test(p)) s -= 3;
  return s;
};

export function findAssetCandidates(html: string): AssetCandidate[] {
  const found = new Map<string, AssetCandidate>();
  const add = (id: string, path: string, label: string | null) => {
    const key = id.toLowerCase();
    let c = found.get(key);
    if (!c) { c = { id: key, score: -9, count: 0, paths: [], labels: [] }; found.set(key, c); }
    c.count++;
    c.score = Math.max(c.score, scorePath(path));
    const short = path.split('.').slice(-5).join('.');
    if (c.paths.length < 3 && !c.paths.includes(short)) c.paths.push(short);
    if (label && c.labels.length < 2 && !c.labels.includes(label)) c.labels.push(label);
  };
  const rec = (node: Json, path: string[], label: string | null, depth: number) => {
    if (depth > 40 || node == null) return;
    if (typeof node === 'string') { if (UUID_RE.test(node)) add(node, path.join('.'), label); return; }
    if (Array.isArray(node)) { for (const x of node.slice(0, 400)) rec(x, path.length && path[path.length - 1] === '[]' ? path : path.concat('[]'), label, depth + 1); return; }
    if (typeof node === 'object') {
      const lab = typeof node.nom === 'string' ? node.nom : typeof node.libelle === 'string' ? node.libelle : label;
      for (const [k, v] of Object.entries(node)) rec(v, path.concat(k), lab, depth + 1);
    }
  };
  for (const blob of jsonBlobs(html)) rec(blob, [], null, 0);
  for (const m of Array.from(html.matchAll(/api\.ffbb\.com\/assets\/([0-9a-f-]{36})/gi))) add(m[1], 'html:url', null);
  return Array.from(found.values());
}

// Meilleur candidat « logo de la compétition » (score >= 3 : chemin de compétition + mot logo, hors clubs).
export function pickCompetitionLogo(html: string): string | null {
  const best = findAssetCandidates(html).filter((c) => c.score >= 3).sort((a, b) => b.score - a.score || b.count - a.count)[0];
  return best?.id ?? null;
}
