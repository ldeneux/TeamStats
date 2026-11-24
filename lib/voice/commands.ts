// lib/voice/commands.ts — analyseur de commandes vocales TeamStats.
// Fonction pure, sans dépendance, sans accès au navigateur : tout se teste avec Node.
// Les noms d'actions renvoyés sont EXACTEMENT ceux de recordEvent (page.tsx).

// ───────────────────────────── Types ─────────────────────────────

/** Joueuse du match telle que l'analyseur la voit. */
export interface VoicePlayer {
  id: string;
  /** Numéro de maillot du match (Player.number). */
  number: number;
  /** Prénom prononcé (1er mot de Player.name). Vide si inconnu : seule la désignation par numéro marche. */
  name: string;
  /** Variantes saisies par l'utilisateur (« Candy », « kandis »…). */
  aliases?: string[];
}

export interface VoiceEventLite { id: string; actionType: string; playerId: string; period?: number }

export interface ParseCtx {
  /** Joueuses actuellement sur le terrain (ids). */
  onCourt: string[];
  /** Événements du match, le plus récent en premier (comme game.events). */
  events: VoiceEventLite[];
  /** Nombre de joueuses sur le terrain (5). */
  courtSize?: number;
  /** Levée d'ambiguïté déjà obtenue : clé = ids candidats triés et joints par « | », valeur = id choisi. */
  prefer?: Record<string, string>;
  /** Corrections apprises au calibrage : mot entendu (normalisé) → mot attendu. */
  wordFixes?: Record<string, string>;
  /** La fenêtre de changement est ouverte à l'écran (permet « valider »). */
  subPanelOpen?: boolean;
  /** Joueuse actuellement sélectionnée à l'écran (sert de joueuse par défaut). */
  selectedId?: string | null;
  /** Exige qu'une joueuse soit sur le terrain pour enregistrer une action (comme l'interface). */
  requireOnCourt?: boolean;
}

export type Cmd =
  | { type: 'UNKNOWN'; say: string; heard?: string; noise?: boolean }
  | { type: 'REFUSE'; say: string }
  | { type: 'ASK'; kind: 'name'; key: string; candidates: string[]; say: string }
  | { type: 'ASK'; kind: 'append'; say: string; progress?: boolean }
  | { type: 'EVENT'; playerId: string; action: string; points: number; designation: string; needsConfirm: boolean; say: string }
  | { type: 'FREE_THROWS'; playerId: string; made: number; attempts: number; say: string }
  | { type: 'FT_START'; playerId: string; say: string }
  | { type: 'FT_ATTEMPT'; index: number | null; made: boolean; say: string }
  | { type: 'FT_DONE'; say: string }
  | { type: 'FT_RATIO'; made: number; attempts: number; say: string }
  | { type: 'OPP'; delta: number; say: string }
  | { type: 'SUB'; outs: string[]; ins: string[]; needsConfirm: true; say: string }
  | { type: 'SET_COURT'; ins: string[]; needsConfirm: true; say: string }
  | { type: 'NOOP'; say: string }
  | { type: 'SELECT'; playerId: string | null; say: string }
  | { type: 'SUBPANEL'; op: 'open' | 'close' | 'validate'; say: string }
  | { type: 'UNDO'; playerId: string | null; eventId: string | null; say: string }
  | { type: 'CLOCK'; running: boolean; say: string }
  | { type: 'Q_SCORE'; say: string }
  | { type: 'Q_COURT'; say: string }
  | { type: 'Q_FOULS'; playerId: string; say: string }
  | { type: 'Q_TEAM_FOULS'; say: string };

// ─────────────────────────── Normalisation ───────────────────────────

export const strip = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ç/g, 's')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`\-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Clé phonétique française simplifiée : deux écritures qui se prononcent pareil donnent la même clé. */
export function phonetic(word: string): string {
  let s = strip(word).replace(/ /g, '');
  s = s
    .replace(/(.)\1+/g, '$1')
    .replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/ck/g, 'k').replace(/gn/g, 'N')
    .replace(/ch(?=[lrn])/g, 'k').replace(/ch|sh/g, 'S')
    .replace(/g([eiy])/g, 'j$1').replace(/c([eiy])/g, 's$1').replace(/c/g, 'k')
    .replace(/y/g, 'i').replace(/w/g, 'v').replace(/h/g, '').replace(/x/g, 'ks')
    .replace(/(ain|ein|in|im|un)(?![aeiouy])/g, 'I').replace(/(an|am|en|em)(?![aeiouy])/g, 'A')
    .replace(/(on|om)(?![aeiouy])/g, 'O')
    .replace(/eau|au/g, 'o').replace(/ou/g, 'u').replace(/ai|ei/g, 'e').replace(/oi/g, 'oa')
    .replace(/(.)\1+/g, '$1').replace(/[esdtx]+$/, '');
  return s;
}

export function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const titleCase = (s: string) => String(s).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// ───────────────────────── Nombres en lettres ─────────────────────────

const UNITS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
};
const TENS: Record<string, number> = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50 };

/** Nombre de 0 à 19 à partir du mot i. */
function under20(w: string[], i: number): { v: number; len: number } | null {
  const a = w[i];
  if (a === undefined) return null;
  if (a === 'dix') {
    const b = w[i + 1];
    if (b === 'sept') return { v: 17, len: 2 };
    if (b === 'huit') return { v: 18, len: 2 };
    if (b === 'neuf') return { v: 19, len: 2 };
    return { v: 10, len: 1 };
  }
  if (a in UNITS) return { v: UNITS[a], len: 1 };
  return null;
}

/** Nombre de 0 à 99, en chiffres ou en lettres, à partir du mot i. */
function numberAt(w: string[], i: number): { v: number; len: number } | null {
  const a = w[i];
  if (a === undefined) return null;
  if (/^\d{1,2}$/.test(a)) return { v: parseInt(a, 10), len: 1 };
  if (a === 'quatre' && (w[i + 1] === 'vingt' || w[i + 1] === 'vingts')) {
    const u = under20(w, i + 2);
    if (u && u.v >= 1) return { v: 80 + u.v, len: 2 + u.len };
    return { v: 80, len: 2 };
  }
  if (a === 'soixante') {
    let j = i + 1;
    if (w[j] === 'et' && (w[j + 1] === 'un' || w[j + 1] === 'onze')) j++;
    const u = under20(w, j);
    if (u && u.v >= 1) return { v: 60 + u.v, len: j - i + u.len };
    return { v: 60, len: 1 };
  }
  if (a in TENS) {
    let j = i + 1;
    if (w[j] === 'et' && w[j + 1] === 'un') return { v: TENS[a] + 1, len: 3 };
    const u = under20(w, j);
    if (u && u.v >= 1 && u.v <= 9) return { v: TENS[a] + u.v, len: 1 + u.len };
    return { v: TENS[a], len: 1 };
  }
  return under20(w, i);
}

/** Remplace les nombres en lettres par des chiffres (« vingt et un » → « 21 »).
 *  « un / une » n'est converti que là où il est un nombre (jamais l'article « un rebond »). */
function numbersToDigits(text: string): string {
  const w = text.split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < w.length;) {
    const word = w[i];
    if (word === 'un' || word === 'une') {
      const nxt = w[i + 1], prv = out[out.length - 1];
      const isNum = nxt === 'sur' || nxt === 'point' || nxt === 'points' || nxt === 'pointe' || nxt === 'pointes' || nxt === 'pts' || nxt === 'pt'
        || prv === 'numero' || prv === 'num' || prv === 'n' || prv === 'la' || prv === 'le' || prv === 'sur' || prv === 'moins' || prv === 'plus';
      if (isNum) { out.push('1'); i++; continue; }
      i++; // article : on le jette
      continue;
    }
    const n = numberAt(w, i);
    if (n) { out.push(String(n.v)); i += n.len; continue; }
    out.push(word);
    i++;
  }
  return out.join(' ');
}

// ───────────────────────── Lexique de commandes ─────────────────────────

// Chaque règle remplace une expression par un code MAJUSCULE (jamais pris pour un prénom).
const RULES: Array<[RegExp, string]> = [
  // « 1/3 » (la normalisation a déjà transformé « 1/3 » en « 1 sur 3 ») ; « x sur n » en premier (lancers francs)
  [/\b([0-3]) sur ([1-3])\b/g, ' LFX$1N$2 '],
  [/\bnumeros?\b|\bnum\b|\bn\b/g, ' NUM '],
  [/\blancers? francs?\b|\blf\b/g, ' LF '],
  // questions
  [/\bcombien de fautes? (?:d )?equipe\b|\bfautes? (?:d )?equipe\b|\bfautes? de l equipe\b/g, ' QTEAMFOULS '],
  [/\bcombien (?:de|d) fautes?\b|\bcombien fautes?\b/g, ' QFOULS '],
  [/\bscore\b/g, ' QSCORE '],
  [/\bsur le terrain\b|\bterrain\b|\ben jeu\b/g, ' COURT '],
  // « sur Alice » seul (la reconnaissance a perdu « faute ») = faute subie
  [/^\s*sur(?= (?!le terrain)\S)/g, ' FSUBIE '],
  // contres
  [/\bcontres? subis?e?\b|\bcontrees?\b/g, ' BLKD '],
  [/\bcontres?\b/g, ' BLK '],
  // fautes (« sur » = subie, « de » = personnelle : petits mots à ne pas jeter)
  [/\bfautes? techniques?\b|\btechniques?\b/g, ' FTECH '],
  [/\bfautes? antisportives?\b|\bantisportives?\b/g, ' FANTI '],
  [/\bfautes? disqualifiantes?\b|\bdisqualifiantes?\b/g, ' FDISQ '],
  [/\bfautes? su ?bi(?:e|es|s|t|te)?\b|\bfautes? sur\b|\bsu ?bi(?:e|es|s|t|te)?\b/g, ' FSUBIE '],
  [/\bfautes? personnelles?\b|\bfautes? (?:de|du|d)\b|\bfautes?\b/g, ' FPERSO '],
  // rebonds
  [/\brebonds? (?:en )?(?:offensifs?|offensives?|off|attaque)\b/g, ' REBO '],
  [/\brebonds? (?:en )?(?:defensifs?|defensives?|def|defense)\b/g, ' REBD '],
  [/\boffensifs?\b|\boffensives?\b/g, ' REBO '],
  [/\bdefensifs?\b|\bdefensives?\b/g, ' REBD '],
  [/\brebonds?\b/g, ' REB '],
  // passe, interception, perte
  [/\bpasses? decisives?\b|\bpasses?\b/g, ' AST '],
  [/\binterceptions?\b|\bintercepte\b|\bvol de balle\b/g, ' STL '],
  [/\bpertes?(?: de)? balles?\b|\b(?:balles?|bal) perdu(?:e|es|s)?\b|\bperdu(?:e|es|s)?\b|\bpertes?\b/g, ' TOV '],
  // points
  [/\b([123]) fois\b/g, ' $1 points '],
  [/\b1 (?:points?|pointes?|poings?|poins?|poils?|poids|pts?)\b/g, ' P1 '],
  [/\b2 (?:points?|pointes?|poings?|poins?|poils?|poids|pts?)\b/g, ' P2 '],
  [/\b3 (?:points?|pointes?|poings?|poins?|poils?|poids|pts?)\b/g, ' P3 '],
  [/\btir a 2\b/g, ' P2 '], [/\btir a 3\b/g, ' P3 '],
  // résultat d'un tir / d'un lancer
  [/\b(?:rates?|ratees?|rater|manques?|manquees?|manquer|loupes?|loupees?)\b/g, ' MISS '],
  [/\b(?:reussis?|reussies?|reussite|dedans|marques?)\b/g, ' MADE '],
  // rangs des lancers francs
  [/\b(?:premiers?|premieres?|1er|1ere)\b/g, ' ORD1 '],
  [/\b(?:deuxiemes?|seconds?|secondes?|2e|2eme|2nd)\b/g, ' ORD2 '],
  [/\b(?:troisiemes?|3e|3eme)\b/g, ' ORD3 '],
  // adversaire
  [/\b(?:l )?autres? equipes?\b|\bequipes? adverses?\b|\b(?:adversaires?|adverses?|eux|visiteurs?)\b/g, ' OPP '],
  [/\bmoins\b/g, ' MOINS '],
  // annulation
  [/\b(?:annule|annuler|annulation|supprime|supprimer|efface|effacer)\b/g, ' UNDO '],
  // chrono
  [/\b(?:temps|tant|ten|tan|tem) ?(?:morts?|mors?|more?|mord)\b|\barrets? de jeu\b|\bcoups? de sifflet\b|\bsifflet\b|\bpause\b|\bstop\b(?! chrono)/g, ' CSTOP '],
  [/\b(?:debuts?|coup d envoi|depart)(?: (?:du|de|des|d))? ?matchs?\b/g, ' CSTART '],
  [/\b(?:demarre|demarrer|demarrez|lance|lancer|lancez|commence|commencer|start)(?: (?:le|du|un|ce))? ?matchs?\b/g, ' CSTART '],
  [/\breprise(?: du jeu)?\b|\breprend\b/g, ' CSTART '],
  [/\bchronos?\b|\bchronometre\b/g, ' CHRONO '],
  [/\b(?:arrete|arreter|arretez|arrets?|stop|stoppe|stopper|pause|coupe|couper)\b/g, ' VSTOP '],
  [/\b(?:demarre|demarrer|demarrez|debuts?|depart|commence|commencer|lance|lancer|lancez|relance|relancer|start|go)\b/g, ' VSTART '],
  // sélection d'une joueuse à l'écran
  [/\b(?:deselectionne|deselectionner|deselectionnez|deselection|aucune joueuse)\b/g, ' DESELECT '],
  [/\b(?:selectionne|selectionner|selectionnez|selection|choisis|choisir|choisissez)\b/g, ' SELECT '],
  // fenêtre de changement : afficher / valider / fermer
  [/\b(?:afficher|affiche|affichez|ouvre|ouvrir|ouvrez|montre|montrer)(?: (?:le|la|les|l|une|un))?(?: fenetre)?(?: (?:de|des|du|d))? ?(?:changements?|remplacements?|joueuses?)\b/g, ' PANELOPEN '],
  [/\b(?:valider|valide|validez)(?: (?:le|la|les))? (?:changements?|remplacements?)\b/g, ' PANELVALID '],
  [/\b(?:fermer|ferme|fermez|masque|masquer)\b/g, ' PANELCLOSE '],
  // changements
  [/\b(?:remplacent|remplace)\b/g, ' REPL '],
  [/\b(?:changements?|remplacements?|change)\b/g, ' SUBX '],
  [/\b(?:sorties?|sortent|sortant|sortants|sortantes|sort|sors|sortir)\b/g, ' OUTM '],
  [/\b(?:entrees?|entrent|entrant|entrants|rentrent|rentre|rentrer|entre)\b/g, ' INM '],
  [/\bpar\b/g, ' PAR '],
  // fin de séquence de lancers francs
  [/\b(?:termine|terminee|termines|fini|finie|finis|fin|c est bon|ca y est|voila|valide|valides|valider|validez|ok|oui)\b/g, ' DONE '],
];

// Petits mots ignorés (le prénom ou le nombre qui suit compte seul). « la / le / numéro » sont traités à part.
const FILLER = new Set([
  'et', 'puis', 'avec', 'de', 'du', 'd', 'des', 'les', 'l', 'a', 'au', 'aux', 'pour', 'donc', 'alors', 'euh', 'heu',
  'allez', 'bon', 'on', 'il', 'y', 'ya', 'est', 'sont', 'qui', 'sur', 'sous', 'en', 'ca', 'cest', 'ce', 'c', 's',
  'derniere', 'dernier', 'commande', 'action', 'joueuse', 'joueuses', 'tir', 'est', 'a', 'fait', 'plus', 'un', 'une',
  'merci', 'svp', 'stp',
]);
const ARTICLES = new Set(['la', 'le']);

// ───────────────────────── Effectif et noms ─────────────────────────

interface RosterEntry { id: string; name: string; number: number; keys: string[] }

function buildRoster(players: VoicePlayer[]): RosterEntry[] {
  return players.map((p) => {
    const variants = p.name ? [p.name, ...(p.aliases ?? [])] : [];
    // Prénom composé (« MARIE ANNE ») : on accepte aussi le premier mot seul
    return {
      id: p.id,
      name: p.name,
      number: p.number,
      keys: Array.from(new Set(variants.map(phonetic).filter(Boolean))),
    };
  });
}

interface NameCand { id: string; d: number }
interface NameTok { k: 'name'; used: number; heard: string; cands: NameCand[] }
interface NumTok { k: 'num'; n: number; art: boolean }
interface CodeTok { k: 'code'; c: string }
interface UnkTok { k: 'unk'; w: string }
type Tok = NameTok | NumTok | CodeTok | UnkTok;

function matchName(words: string[], i: number, roster: RosterEntry[]): NameTok | null {
  let best: NameTok | null = null;
  for (const n of [2, 1]) {
    if (i + n > words.length) continue;
    const slice = words.slice(i, i + n);
    if (slice.some((w) => /^[A-Z0-9]+$/.test(w) || FILLER.has(w) || ARTICLES.has(w))) continue;
    const raw = slice.join('');
    if (raw.length < 3) continue;
    const pk = phonetic(raw);
    if (!pk) continue;
    const cands: NameCand[] = [];
    for (const p of roster) {
      let dmin = 99;
      for (const k of p.keys) {
        const d = lev(pk, k);
        const ok = d === 0 || (d === 1 && (k.length >= 4 || (k.length === 3 && k[0] === pk[0])));
        if (ok && d < dmin) dmin = d;
      }
      if (dmin < 99) cands.push({ id: p.id, d: dmin });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => a.d - b.d);
    const cur: NameTok = { k: 'name', used: n, heard: raw, cands };
    if (!best || cur.cands[0].d < best.cands[0].d || (cur.cands[0].d === best.cands[0].d && cur.used > best.used)) best = cur;
  }
  return best;
}

// Mots de commande « canoniques » : un mot inconnu à une lettre près est ramené à l'un d'eux (« interseption » -> « interception »).
const CMD_WORDS = ['interception', 'intercepte', 'rebond', 'rebonds', 'offensif', 'defensif', 'offensive', 'defensive', 'passe', 'passes', 'decisive', 'perte', 'pertes', 'balle', 'balles', 'perdue', 'faute', 'fautes',
  'technique', 'antisportive', 'disqualifiante', 'subie', 'subies', 'personnelle', 'adversaire', 'adversaires', 'remplacement', 'changement', 'sortie', 'sorties', 'entree', 'entrees', 'annule', 'annuler', 'chrono',
  'demarrer', 'demarre', 'arreter', 'termine', 'premier', 'deuxieme', 'troisieme', 'reussi', 'reussie', 'manque', 'manques', 'loupe', 'points', 'pointe', 'contree', 'terrain', 'equipe', 'combien', 'score', 'afficher',
  'fermer', 'valider', 'selectionne', 'selectionner', 'lancer', 'lancers', 'francs', 'reprise', 'match', 'temps', 'marque', 'supprime', 'efface', 'deselectionner', 'decisives'];
const CMD_SET = new Set(CMD_WORDS);

function correctWords(t: string, roster: RosterEntry[]): string {
  const words = t.split(' ');
  const nameLike = (x: string) => { const pk = phonetic(x); return !!pk && roster.some((p) => p.keys.some((k) => pk[0] === k[0] && lev(pk, k) <= (k.length >= 4 ? 1 : 0))); };
  return words.map((w, i) => {
    if (w.length < 5 || /\d/.test(w) || CMD_SET.has(w) || isLexiconWord(w)) return w;
    // un mot qui ressemble à un prénom de l'effectif (seul, ou coupé en deux : « ana belle ») n'est jamais « corrigé »
    if (nameLike(w) || (i > 0 && nameLike(words[i - 1] + w)) || (i < words.length - 1 && nameLike(w + words[i + 1]))) return w;
    let best = '', bd = 99, tie = false;
    for (const cw of CMD_WORDS) {
      const d = lev(w, cw);
      if (d < bd) { bd = d; best = cw; tie = false; } else if (d === bd && cw !== best) tie = true;
    }
    return bd <= (w.length >= 9 ? 2 : 1) && !tie ? best : w;
  }).join(' ');
}

export function normalizeText(text: string, fixes?: Record<string, string>, roster?: RosterEntry[]): string {
  // « 1/3 » → « 1 sur 3 » (avant que la normalisation ne remplace « / » par une espace)
  let t = String(text ?? '').replace(/(\d)\s*\/\s*(\d)/g, '$1 sur $2').replace(/(^|\s)[-−–—]\s*(\d)/g, '$1moins $2');   // « adversaire - 1 » = « moins un »
  t = t.replace(/n\s*°\s*(\d)/gi, 'numero $1').replace(/n°/gi, ' numero ');
  t = strip(t).replace(/numeros?(\d)/g, 'numero $1');
  if (roster) t = correctWords(t, roster);
  t = numbersToDigits(t);
  if (fixes) {
    // corrections apprises (calibrage), appliquées APRÈS la conversion des nombres en chiffres : les clés sont écrites ainsi (« en 10 » → « candice »)
    for (const k of Object.keys(fixes).sort((a, b) => b.length - a.length)) {
      if (!k || k === fixes[k]) continue;
      if (!/^[a-z0-9 ]+$/.test(k)) continue; // clés déjà normalisées : lettres, chiffres, espaces
      t = t.replace(new RegExp(`(^| )${k}(?= |$)`, 'g'), `$1${fixes[k]}`);
    }
  }
  for (const [re, rep] of RULES) t = t.replace(re, rep);
  return t.replace(/\s+/g, ' ').trim();
}

function tokenize(text: string, roster: RosterEntry[], fixes?: Record<string, string>): Tok[] {
  const words = normalizeText(text, fixes, roster).split(' ').filter(Boolean);
  const toks: Tok[] = [];
  let art = false;
  for (let i = 0; i < words.length;) {
    const w = words[i];
    if (w === 'NUM') { art = true; i++; continue; }
    if (ARTICLES.has(w)) { art = true; i++; continue; }
    if (/^[A-Z][A-Z0-9]*$/.test(w)) { toks.push({ k: 'code', c: w }); art = false; i++; continue; }
    if (/^\d{1,2}$/.test(w)) { toks.push({ k: 'num', n: parseInt(w, 10), art }); art = false; i++; continue; }
    if (FILLER.has(w)) { i++; continue; }
    const m = matchName(words, i, roster);
    if (m) { toks.push(m); i += m.used; art = false; continue; }
    toks.push({ k: 'unk', w }); art = false; i++;
  }
  return toks;
}

/** Joueuse la plus proche (phonétique) d'un mot inconnu : l'unique mot restant d'une commande est très probablement un prénom mal entendu. */
function nearestPlayer(word: string, roster: RosterEntry[], onCourt: Set<string>): string | null {
  const pk = phonetic(word);
  if (pk.length < 2) return null;
  const scored: Array<{ id: string; d: number }> = [];
  for (const p of roster) {
    let dmin = 99;
    for (const k of p.keys) if (k[0] === pk[0]) dmin = Math.min(dmin, lev(pk, k));
    const limit = pk.length >= 5 ? 2 : 1;
    if (dmin <= limit) scored.push({ id: p.id, d: dmin });
  }
  if (!scored.length) return null;
  const best = Math.min(...scored.map((x) => x.d));
  let top = scored.filter((x) => x.d === best);
  if (top.length > 1) { const onc = top.filter((x) => onCourt.has(x.id)); if (onc.length) top = onc; }
  return top.length === 1 ? top[0].id : null;
}

/** Texte normalisé avec nombres en chiffres (« trois » → « 3 ») : base de comparaison du calibrage. */
export const toDigitsText = (t: string): string => numbersToDigits(strip(t));

/** Mot qui déclenche une commande ou un nombre (hors petits mots et prénoms) : ne doit jamais être remplacé par apprentissage. */
export function isCommandWord(word: string): boolean {
  const w = strip(word);
  return !!w && /[A-Z0-9]/.test(normalizeText(w));
}

/** Mot déjà porteur de sens pour l'analyseur (commande, nombre, petit mot ignoré) : jamais « corrigé » par apprentissage. */
export function isLexiconWord(word: string): boolean {
  const w = strip(word);
  return !w || FILLER.has(w) || ARTICLES.has(w) || /[A-Z0-9]/.test(normalizeText(w));
}

// ───────────────────────── Aides sur les fautes ─────────────────────────

/** Miroir de getFoulsCount (page.tsx). */
export function countFouls(events: VoiceEventLite[], playerId: string): number {
  const f = events.filter((e) => e.playerId === playerId && e.actionType.includes('FAUTE') && !e.actionType.includes('SUBIE'));
  if (f.some((e) => e.actionType.includes('DISQUALIFIANTE'))) return 5;
  if (f.filter((e) => e.actionType.includes('ANTISPORTIVE')).length >= 2) return 5;
  return f.length;
}

/** Dernier événement « réel » : ni changement, ni marqueur interne (miroir de getLastPlayerAction). */
export function lastRealEvent(events: VoiceEventLite[], playerId: string | null): VoiceEventLite | null {
  return events.find((e) => (playerId === null || e.playerId === playerId) && !e.actionType.startsWith('REMPLACEMENT') && !e.actionType.startsWith('ETAT:')) ?? null;
}

// ───────────────────────── Désignation d'une joueuse ─────────────────────────

const labelOf = (roster: VoicePlayer[], id: string): string => {
  const p = roster.find((x) => x.id === id);
  return p?.name ? titleCase(p.name) : `numéro ${p?.number ?? '?'}`;
};

/** Nom prononcé pour une joueuse, sans ambiguïté si deux joueuses ont le même prénom. */
const sayName = (roster: VoicePlayer[], id: string): string => {
  const p = roster.find((x) => x.id === id);
  if (!p) return '?';
  if (!p.name) return `numéro ${p.number}`;
  const same = roster.filter((x) => x.name && strip(x.name) === strip(p.name));
  return same.length > 1 ? `${titleCase(p.name)}, numéro ${p.number}` : titleCase(p.name);
};

type Role = 'any' | 'out' | 'in' | 'court';
type Resolved =
  | { ok: true; id: string; byNumber: boolean }
  | { ok: false; kind: 'ask'; key: string; candidates: string[] }
  | { ok: false; kind: 'refuse'; say: string };

interface Env { players: VoicePlayer[]; ctx: ParseCtx; onCourt: Set<string> }

function fouledOut(env: Env, id: string): boolean { return countFouls(env.ctx.events, id) >= 5; }

function roleFits(env: Env, id: string, role: Role): boolean {
  if (role === 'out') return env.onCourt.has(id) || fouledOut(env, id);
  if (role === 'in') return !env.onCourt.has(id) && !fouledOut(env, id);
  if (role === 'court') return env.onCourt.size === 0 || env.onCourt.has(id);
  return true;
}

function resolveTok(tok: NameTok | NumTok, role: Role, env: Env): Resolved {
  if (tok.k === 'num') {
    const hits = env.players.filter((p) => p.number === tok.n);
    if (hits.length === 0) return { ok: false, kind: 'refuse', say: `Numéro ${tok.n} : pas de joueuse.` };
    if (hits.length > 1) return { ok: false, kind: 'refuse', say: `Numéro ${tok.n} : deux joueuses. Utilise le prénom.` };
    return { ok: true, id: hits[0].id, byNumber: true };
  }
  const ids = tok.cands.map((c) => c.id);
  const key = [...ids].sort().join('|');
  const chosen = env.ctx.prefer?.[key];
  if (chosen && ids.includes(chosen)) return { ok: true, id: chosen, byNumber: false };
  if (ids.length === 1) return { ok: true, id: ids[0], byNumber: false };
  // 1) le contexte tranche (sortie : celle du terrain ; entrée : celle du banc ; action : celle du terrain)
  const fitting = tok.cands.filter((c) => roleFits(env, c.id, role));
  const pool = fitting.length ? fitting : tok.cands;
  if (pool.length === 1) return { ok: true, id: pool[0].id, byNumber: false };
  // 2) sinon, la meilleure distance si elle est seule
  const dmin = Math.min(...pool.map((c) => c.d));
  const top = pool.filter((c) => c.d === dmin);
  if (top.length === 1) return { ok: true, id: top[0].id, byNumber: false };
  // 3) sinon on pose la question
  return { ok: false, kind: 'ask', key, candidates: top.map((c) => c.id) };
}

function askName(res: Extract<Resolved, { kind: 'ask' }>, env: Env): Cmd {
  const names = res.candidates.map((id) => sayName(env.players, id));
  return { type: 'ASK', kind: 'name', key: res.key, candidates: res.candidates, say: `${names.join(' ou ')} ?` };
}

/** « Faute personnelle, numéro 5, Candice » / « numéro 5 » / « Candice ». */
function designation(env: Env, id: string, byNumber: boolean): string {
  const p = env.players.find((x) => x.id === id);
  if (!p) return '?';
  if (byNumber) return p.name ? `numéro ${p.number}, ${titleCase(p.name)}` : `numéro ${p.number}`;
  return sayName(env.players, id);
}

// ───────────────────────── Actions ─────────────────────────

const EVENT: Record<string, { made: string; miss: string | null; say: string; sayMiss?: string }> = {
  P2: { made: 'TIR 2PTS RÉUSSI', miss: 'TIR 2PTS Manqué', say: 'deux points', sayMiss: 'deux points raté' },
  P3: { made: 'TIR 3PTS RÉUSSI', miss: 'TIR 3PTS Manqué', say: 'trois points', sayMiss: 'trois points raté' },
  REBO: { made: 'REBOND OFFENSIF', miss: null, say: 'rebond offensif' },
  REBD: { made: 'REBOND DÉFENSIF', miss: null, say: 'rebond défensif' },
  AST: { made: 'PASSE DÉCISIVE', miss: null, say: 'passe décisive' },
  STL: { made: 'INTERCEPTION', miss: null, say: 'interception' },
  TOV: { made: 'PERTE DE BALLE', miss: null, say: 'perte de balle' },
  BLK: { made: 'CONTRE', miss: null, say: 'contre' },
  BLKD: { made: 'CONTRE SUBI', miss: null, say: 'contre subi' },
  FSUBIE: { made: 'FAUTE SUBIE', miss: null, say: 'faute subie' },
  FPERSO: { made: 'FAUTE PERSONNELLE', miss: null, say: 'faute personnelle' },
  FTECH: { made: 'FAUTE TECHNIQUE', miss: null, say: 'faute technique' },
  FANTI: { made: 'FAUTE ANTISPORTIVE', miss: null, say: 'faute antisportive' },
  FDISQ: { made: 'FAUTE DISQUALIFIANTE', miss: null, say: 'faute disqualifiante' },
};
// Aucune action de joueuse ne demande de confirmation (saisie rapide) : « annule la dernière commande » corrige.
// Pour réactiver la confirmation d'une faute : y remettre 'FTECH', 'FANTI', 'FDISQ'.
const CONFIRM_ACTIONS = new Set<string>();

export const FT_ORDINALS = ['premier', 'deuxième', 'troisième'];

export interface ParseOpts {
  /** true : une session de lancers francs est ouverte (le parseur reconnaît « premier réussi », « terminé »…). */
  ftSession?: boolean;
  /** true (défaut) : « réussi » / « raté » seuls = tentative suivante, pendant une session. */
  ftBareNext?: boolean;
}

/**
 * parseCommand(texte, effectif, contexte) → commande.
 * Le texte vient de la reconnaissance vocale ; l'effectif ne contient que les joueuses du match.
 */
export function parseCommand(text: string, players: VoicePlayer[], ctx: ParseCtx, opts: ParseOpts = {}): Cmd {
  const roster = buildRoster(players);
  const env: Env = { players, ctx, onCourt: new Set(ctx.onCourt) };
  const courtSize = ctx.courtSize ?? 5;
  const toks = tokenize(text, roster, ctx.wordFixes);
  if (!toks.length) return { type: 'UNKNOWN', say: "Commande non reconnue.", noise: true };

  const codes = toks.filter((t): t is CodeTok => t.k === 'code').map((t) => t.c);
  const has = (c: string) => codes.includes(c);
  const unknown = toks.filter((t): t is UnkTok => t.k === 'unk').map((t) => t.w);
  const nameToks = toks.filter((t): t is NameTok => t.k === 'name');
  const numToks = toks.filter((t): t is NumTok => t.k === 'num');
  const anyName = nameToks.length > 0;

  // Un nombre restant est un numéro de maillot s'il est précédé de « la / le / numéro », ou si la phrase n'a aucun prénom.
  const jerseyToks = numToks.filter((t) => t.art || !anyName);
  // Désignations de joueuses, dans l'ordre de la phrase.
  const desig = toks.filter((t): t is NameTok | NumTok => t.k === 'name' || (t.k === 'num' && (t.art || !anyName)));

  // ───── Session de lancers francs
  if (opts.ftSession) {
    const ft = parseFtSessionWord(toks, codes, numToks, desig.length > 0, opts.ftBareNext !== false);
    if (ft) return ft;
  }

  // ───── Questions
  if (has('QSCORE')) return { type: 'Q_SCORE', say: 'Score' };
  if (has('QTEAMFOULS')) return { type: 'Q_TEAM_FOULS', say: "Fautes d'équipe" };
  if (has('QFOULS')) {
    if (desig.length !== 1) return { type: 'ASK', kind: 'append', say: 'Quelle joueuse ?' };
    const r = resolveTok(desig[0], 'any', env);
    if (!r.ok) return r.kind === 'ask' ? askName(r, env) : { type: 'REFUSE', say: r.say };
    return { type: 'Q_FOULS', playerId: r.id, say: `Fautes de ${designation(env, r.id, r.byNumber)}` };
  }

  // ───── Sélection d'une joueuse (sans action)
  if (has('DESELECT')) return { type: 'SELECT', playerId: null, say: 'Sélection retirée' };
  if (has('SELECT')) {
    if (desig.length !== 1) return desig.length > 1 ? { type: 'REFUSE', say: 'Une seule joueuse à la fois.' } : { type: 'ASK', kind: 'append', say: 'Quelle joueuse ?' };
    const r = resolveTok(desig[0], 'court', env);
    if (!r.ok) return r.kind === 'ask' ? askName(r, env) : { type: 'REFUSE', say: r.say };
    if (env.onCourt.size > 0 && !env.onCourt.has(r.id)) return { type: 'REFUSE', say: `${designation(env, r.id, r.byNumber)} n'est pas sur le terrain.` };
    return { type: 'SELECT', playerId: r.id, say: `${designation(env, r.id, r.byNumber)} sélectionnée` };
  }

  // ───── Fenêtre de changement (écran)
  if (has('PANELOPEN')) return { type: 'SUBPANEL', op: 'open', say: 'Changement affiché' };
  if (has('PANELCLOSE')) return { type: 'SUBPANEL', op: 'close', say: 'Fermé' };
  if (has('PANELVALID') || (has('DONE') && ctx.subPanelOpen && !desig.length && !unknown.length && codes.every((x) => x === 'DONE'))) {
    return { type: 'SUBPANEL', op: 'validate', say: 'Changement validé' };
  }

  // ───── Chrono
  const clockStart = has('CSTART') || (has('CHRONO') && has('VSTART'));
  const clockStop = has('CSTOP') || (has('CHRONO') && has('VSTOP'));
  if (clockStart && !clockStop) return { type: 'CLOCK', running: true, say: 'Chrono lancé' };
  if (clockStop && !clockStart) return { type: 'CLOCK', running: false, say: 'Chrono arrêté' };
  if (has('CHRONO') && !desig.length) return { type: 'ASK', kind: 'append', say: 'Démarrer ou arrêter ?' };

  // ───── Annulation
  if (has('UNDO')) {
    if (desig.length > 1) return { type: 'REFUSE', say: 'Une seule joueuse à la fois.' };
    let pid: string | null = null;
    if (desig.length === 1) {
      const r = resolveTok(desig[0], 'any', env);
      if (!r.ok) return r.kind === 'ask' ? askName(r, env) : { type: 'REFUSE', say: r.say };
      pid = r.id;
    }
    const ev = lastRealEvent(ctx.events, pid);
    if (!ev) return { type: 'REFUSE', say: pid ? `Rien à annuler pour ${sayName(players, pid)}.` : 'Rien à annuler.' };
    const who = ev.playerId ? sayName(players, ev.playerId) : '';
    return {
      type: 'UNDO', playerId: pid, eventId: ev.id,
      say: `Annulé : ${describeAction(ev.actionType)}${who ? ', ' + who : ''}`,
    };
  }

  // ───── Changements (trois formulations)
  const isSubCmd = has('SUBX') || has('OUTM') || has('INM') || has('REPL') || has('PAR');
  const isCourtList = has('COURT') && desig.length > 0;
  if (isSubCmd || isCourtList) {
    return parseSubstitution(toks, codes, desig, unknown, env, courtSize, isCourtList && !isSubCmd);
  }
  if (has('COURT')) return { type: 'Q_COURT', say: 'Sur le terrain' };

  // ───── Score adverse
  if (has('OPP')) {
    const fromCode = codes.find((c) => c === 'P1' || c === 'P2' || c === 'P3');
    const fromNum = numToks.find((t) => t.n >= 1 && t.n <= 3)?.n;
    const pts = fromCode ? Number(fromCode[1]) : fromNum;
    if (!pts) return { type: 'ASK', kind: 'append', say: "Combien de points pour l'adversaire ?" };
    const delta = pts * (has('MOINS') ? -1 : 1);
    return { type: 'OPP', delta, say: `Adversaire ${delta > 0 ? 'plus' : 'moins'} ${Math.abs(delta)}` };
  }

  // ───── Lancers francs
  const lfx = codes.find((c) => c.startsWith('LFX'));
  const hasLF = has('LF') || !!lfx;

  // Points « nus » : « Candice deux » = deux points (tolérance de la reconnaissance), seulement avec un prénom
  // et jamais pour un nombre précédé de « la / le / numéro ».
  const bareNums = numToks.filter((t) => !t.art && anyName && (t.n === 2 || t.n === 3));
  const codesWithBare = [...codes];
  if (bareNums.length === 1 && !codes.some((c) => c === 'P2' || c === 'P3') && !hasLF) codesWithBare.push(`P${bareNums[0].n}`);

  let actionCodes = codesWithBare.filter((c) => EVENT[c] || c === 'REB' || c === 'P1');
  if (actionCodes.includes('REBO') || actionCodes.includes('REBD')) actionCodes = actionCodes.filter((c) => c !== 'REB');
  actionCodes = Array.from(new Set(actionCodes));
  // « Chloé a subi une faute » : subie ET faute dans la même phrase -> c'est la faute SUBIE. Une faute précisée (technique…) l'emporte aussi sur « faute » seule.
  if (actionCodes.includes('FPERSO') && actionCodes.some((x) => x === 'FSUBIE' || x === 'FTECH' || x === 'FANTI' || x === 'FDISQ')) actionCodes = actionCodes.filter((x) => x !== 'FPERSO');

  // ───── Joueuse visée
  const needsPlayer = actionCodes.length > 0 || hasLF;
  if (desig.length > 1) {
    return { type: 'REFUSE', say: 'Une seule joueuse à la fois.' };
  }
  let who: string | null = null;
  let byNumber = false;
  if (desig.length === 1) {
    const r = resolveTok(desig[0], 'court', env);
    if (!r.ok) return r.kind === 'ask' ? askName(r, env) : { type: 'REFUSE', say: r.say };
    who = r.id; byNumber = r.byNumber;
  }

  if (!actionCodes.length && !hasLF) {
    if (who && !unknown.length) return { type: 'ASK', kind: 'append', say: `${designation(env, who, byNumber)}, quoi ?` };
    return { type: 'UNKNOWN', say: "Commande non reconnue.", heard: unknown.join(' '), noise: toks.every((t) => t.k === 'unk' && !CMD_SET.has(t.w)) };
  }
  if (actionCodes.length > 1 || (actionCodes.length === 1 && hasLF)) return { type: 'REFUSE', say: 'Une seule action à la fois.' };
  if (!who && unknown.length === 1 && (actionCodes.length > 0 || hasLF)) {
    const near = nearestPlayer(unknown[0], roster, env.onCourt);
    if (near) { who = near; byNumber = false; }
  }
  if (!who && ctx.selectedId && players.some((p) => p.id === ctx.selectedId)) { who = ctx.selectedId; byNumber = false; }
  if (!who) return needsPlayer ? { type: 'ASK', kind: 'append', say: 'Quelle joueuse ?' } : { type: 'UNKNOWN', say: "Commande non reconnue." };

  if (ctx.requireOnCourt !== false && env.onCourt.size > 0 && !env.onCourt.has(who)) {
    return { type: 'REFUSE', say: `${designation(env, who, byNumber)} n'est pas sur le terrain.` };
  }
  const nm = designation(env, who, byNumber);

  if (hasLF) {
    const miss = has('MISS'), made = has('MADE');
    if (lfx) {
      const [m, a] = lfx.slice(3).split('N').map(Number);
      return ftResult(who, m, a, nm);
    }
    if (made || miss) return ftResult(who, miss ? 0 : 1, 1, nm);
    return { type: 'FT_START', playerId: who, say: `Lancers francs, ${nm}` };
  }

  const code = actionCodes[0];
  if (code === 'REB') return { type: 'ASK', kind: 'append', say: `${nm}, rebond offensif ou défensif ?` };
  if (code === 'P1') return { type: 'ASK', kind: 'append', say: `${nm}, lancer franc ? Dis lancer franc réussi ou raté.` };

  const e = EVENT[code];
  const miss = has('MISS');
  if (miss && !e.miss) return { type: 'REFUSE', say: '« Raté » ne va qu\'avec un tir.' };
  const action = miss ? (e.miss as string) : e.made;
  const points = !miss && code === 'P2' ? 2 : !miss && code === 'P3' ? 3 : 0;
  const spoken = miss ? e.sayMiss ?? e.say : e.say;
  const sayStart = code.startsWith('F') ? `${spoken.charAt(0).toUpperCase()}${spoken.slice(1)}, ${nm}` : `${nm}, ${spoken}`;
  return { type: 'EVENT', playerId: who, action, points, designation: nm, needsConfirm: CONFIRM_ACTIONS.has(code), say: sayStart };
}

function ftResult(playerId: string, made: number, attempts: number, nm: string): Cmd {
  if (attempts < 1 || attempts > 3 || made > attempts) return { type: 'REFUSE', say: 'Lancers francs impossibles.' };
  return { type: 'FREE_THROWS', playerId, made, attempts, say: `${nm}, lancers francs, ${made} sur ${attempts}` };
}

function describeAction(a: string): string {
  const m = a.match(/^TIR (\d)PTS RÉUSSI$/); if (m) return `${m[1] === '2' ? 'deux' : 'trois'} points`;
  const mm = a.match(/^TIR (\d)PTS Manqué$/); if (mm) return `${mm[1] === '2' ? 'deux' : 'trois'} points raté`;
  const lf = a.match(/^LANCERS FRANCS \((\d+)\/(\d+)\)$/); if (lf) return `lancers francs ${lf[1]} sur ${lf[2]}`;
  return a.toLowerCase();
}

// ───────────────────────── Session de lancers francs ─────────────────────────

function parseFtSessionWord(toks: Tok[], codes: string[], numToks: NumTok[], hasDesig: boolean, bareNext: boolean): Cmd | null {
  const lfx = codes.find((c) => c.startsWith('LFX'));
  if (lfx && !hasDesig) {
    const [m, a] = lfx.slice(3).split('N').map(Number);
    if (a < 1 || a > 3 || m > a) return { type: 'REFUSE', say: 'Lancers francs impossibles.' };
    return { type: 'FT_RATIO', made: m, attempts: a, say: '' };
  }
  const ord = codes.includes('ORD1') ? 0 : codes.includes('ORD2') ? 1 : codes.includes('ORD3') ? 2 : null;
  const miss = codes.includes('MISS'), made = codes.includes('MADE');
  const otherAction = codes.some((c) => EVENT[c] || c === 'REB' || c === 'LF' || c === 'OPP' || c === 'UNDO' || c === 'SUBX' || c === 'OUTM' || c === 'INM' || c === 'PAR');
  if ((made || miss) && !hasDesig && !otherAction) {
    if (ord !== null) return { type: 'FT_ATTEMPT', index: ord, made: made && !miss, say: '' };
    if (bareNext) return { type: 'FT_ATTEMPT', index: null, made: made && !miss, say: '' };
  }
  if (ord !== null && !made && !miss && !hasDesig && !otherAction) return { type: 'ASK', kind: 'append', say: 'Réussi ou raté ?' };
  void toks; void numToks;
  if (codes.includes('DONE') && !hasDesig && !otherAction) return { type: 'FT_DONE', say: '' };
  return null;
}

// ───────────────────────── Changements ─────────────────────────

function parseSubstitution(
  toks: Tok[], codes: string[], desig: Array<NameTok | NumTok>, unknown: string[],
  env: Env, courtSize: number, courtListOnly: boolean,
): Cmd {
  const has = (c: string) => codes.includes(c);
  const issues: string[] = [];
  const label = (t: NameTok | NumTok) => (t.k === 'name' ? titleCase(t.heard) : `numéro ${t.n}`);

  // ----- « Sur le terrain on a A, B, C, D, E »
  if (courtListOnly) {
    const ids: string[] = [];
    for (const t of desig) {
      const r = resolveTok(t, 'any', env);
      if (!r.ok) return r.kind === 'ask' ? askName(r, env) : { type: 'REFUSE', say: r.say };
      ids.push(r.id);
    }
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) return { type: 'REFUSE', say: `${sayName(env.players, dup)} est citée deux fois.` };
    if (ids.length !== courtSize) {
      // Moins de 5 : une hésitation coupe souvent la phrase en deux. On attend la suite au lieu de refuser.
      if (ids.length < courtSize) return { type: 'ASK', kind: 'append', progress: true, say: `${ids.length} sur ${courtSize}. La suite ?` };
      return { type: 'REFUSE', say: `Il en faut ${courtSize}, j'en ai entendu ${ids.length}.` };
    }
    for (const id of ids) {
      if (!env.onCourt.has(id) && fouledOut(env, id)) return { type: 'REFUSE', say: `${sayName(env.players, id)} a cinq fautes.` };
    }
    const current = Array.from(env.onCourt);
    if (current.length === 0) {
      return { type: 'SET_COURT', ins: ids, needsConfirm: true, say: `Sur le terrain : ${ids.map((i) => sayName(env.players, i)).join(', ')}. Valide ?` };
    }
    const outs = current.filter((id) => !ids.includes(id));
    const ins = ids.filter((id) => !env.onCourt.has(id));
    if (!outs.length && !ins.length) return { type: 'NOOP', say: 'Rien ne change.' };
    if (outs.length !== ins.length) {
      return { type: 'REFUSE', say: `Il y a ${current.length} joueuses sur le terrain. Dis remplacement, puis la joueuse qui sort, par celle qui entre.` };
    }
    return subCmd(outs, ins, env);
  }

  // ----- Formes « remplacement X par Y », « sortie X entrée Y », « X remplace Y »
  const outs: Array<NameTok | NumTok> = [];
  const ins: Array<NameTok | NumTok> = [];
  const hasMarkers = has('OUTM') || has('INM');
  if (hasMarkers) {
    let mode: 'out' | 'in' | null = null;
    for (const t of toks) {
      if (t.k === 'code' && t.c === 'OUTM') mode = 'out';
      else if (t.k === 'code' && t.c === 'INM') mode = 'in';
      else if (t.k === 'name' || (t.k === 'num' && (t.art || !toks.some((x) => x.k === 'name')))) {
        if (!mode) issues.push(`${label(t)} : sortie ou entrée ?`);
        else (mode === 'out' ? outs : ins).push(t);
      }
    }
  } else if (has('PAR')) {
    let side: 'out' | 'in' = 'out';
    for (const t of toks) {
      if (t.k === 'code' && t.c === 'PAR') side = 'in';
      else if (t.k === 'name' || (t.k === 'num' && (t.art || !toks.some((x) => x.k === 'name')))) (side === 'out' ? outs : ins).push(t);
    }
  } else if (has('REPL')) {
    const seq = toks.filter((t) => t.k === 'name' || t.k === 'num' || (t.k === 'code' && t.c === 'REPL')) as Array<Tok>;
    for (let k = 0; k < seq.length; k++) {
      const s = seq[k];
      if (s.k !== 'code') continue;
      const a = seq[k - 1], b = seq[k + 1];
      if (!a || !b || a.k === 'code' || b.k === 'code') { issues.push('« remplace » demande une joueuse avant et une après'); continue; }
      ins.push(a as NameTok | NumTok); outs.push(b as NameTok | NumTok);
    }
  } else if (desig.length) {
    issues.push('sortie ou entrée ?');
  } else {
    return { type: 'ASK', kind: 'append', say: 'Quelles joueuses ?' };
  }

  if (unknown.length) return { type: 'UNKNOWN', say: 'Commande non reconnue.' };
  if (issues.length) return { type: 'REFUSE', say: issues.join('. ') + '.' };

  const outIds: string[] = [], inIds: string[] = [];
  for (const [list, role, dest] of [[outs, 'out', outIds], [ins, 'in', inIds]] as const) {
    for (const t of list) {
      const r = resolveTok(t, role, env);
      if (!r.ok) return r.kind === 'ask' ? askName(r, env) : { type: 'REFUSE', say: r.say };
      dest.push(r.id);
    }
  }
  if (!outIds.length || outIds.length !== inIds.length) {
    return { type: 'REFUSE', say: `Il faut autant de sorties (${outIds.length}) que d'entrées (${inIds.length}).` };
  }
  return subCmd(outIds, inIds, env);
}

/** Règles communes d'un changement ; si l'une échoue on le dit et on ne change rien. */
function subCmd(outIds: string[], inIds: string[], env: Env): Cmd {
  const all = [...outIds, ...inIds];
  const dup = all.find((id, i) => all.indexOf(id) !== i);
  if (dup) return { type: 'REFUSE', say: `${sayName(env.players, dup)} est citée deux fois.` };
  for (const id of outIds) {
    // une joueuse qui vient de sortir à la 5e faute n'est plus sur le terrain mais peut être « remplacée »
    if (!env.onCourt.has(id) && !fouledOut(env, id)) return { type: 'REFUSE', say: `${sayName(env.players, id)} n'est pas sur le terrain.` };
  }
  for (const id of inIds) {
    if (env.onCourt.has(id)) return { type: 'REFUSE', say: `${sayName(env.players, id)} est déjà sur le terrain.` };
    if (fouledOut(env, id)) return { type: 'REFUSE', say: `${sayName(env.players, id)} a cinq fautes, elle ne peut pas entrer.` };
  }
  const n = (ids: string[]) => ids.map((i) => sayName(env.players, i)).join(', ');
  return {
    type: 'SUB', outs: outIds, ins: inIds, needsConfirm: true,
    say: `Sortent ${n(outIds)}. Entrent ${n(inIds)}. Valide ?`,
  };
}

// ───────────────────────── Confirmation ─────────────────────────

/** Réponse à une demande de confirmation. */
export function parseConfirm(text: string): 'yes' | 'no' | null {
  const t = strip(text);
  if (/\b(non|annule|annuler|stop|laisse tomber|pas ca|negatif)\b/.test(t)) return 'no';
  if (/\b(oui|valide|validé|ok|confirme|d accord|c est bon|vas y|affirmatif|yes)\b/.test(t)) return 'yes';
  return null;
}

/** Réponse à « Annabelle ou Annaelle ? » : renvoie l'id choisi parmi les candidats, ou null. */
export function parseNameAnswer(text: string, players: VoicePlayer[], candidates: string[]): string | null {
  const pool = players.filter((p) => candidates.includes(p.id));
  const roster = buildRoster(pool);
  const toks = tokenize(text, roster);
  for (const t of toks) {
    if (t.k === 'name') {
      const dmin = Math.min(...t.cands.map((c) => c.d));
      const top = t.cands.filter((c) => c.d === dmin);
      if (top.length === 1) return top[0].id;
    }
    if (t.k === 'num') {
      const hit = pool.filter((p) => p.number === t.n);
      if (hit.length === 1) return hit[0].id;
    }
  }
  return null;
}
