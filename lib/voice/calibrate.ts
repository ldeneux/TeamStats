// lib/voice/calibrate.ts — logique pure du calibrage de la commande vocale (testable sans navigateur ni base) :
// liste de phrases à lire, évaluation de ce que le navigateur a entendu, apprentissage des écarts.
// Pas d'audio : seulement du texte (variantes de prénoms, corrections de mots).

import { Cmd, ParseCtx, ParseOpts, VoicePlayer, isCommandWord, parseCommand, strip, toDigitsText } from './commands';

export interface VoiceProfile {
  /** prénom normalisé → variantes entendues. */
  aliases: Record<string, string[]>;
  /** mot entendu (normalisé) → mot attendu. */
  wordFixes: Record<string, string>;
  calibratedAt: string | null;
}
export const emptyProfile = (): VoiceProfile => ({ aliases: {}, wordFixes: {}, calibratedAt: null });

export function addAliasTo(p: VoiceProfile, first: string, word: string): VoiceProfile {
  const k = strip(first), w = strip(word);
  if (!k || !w || w === k) return p;
  const cur = p.aliases[k] ?? [];
  return cur.includes(w) ? p : { ...p, aliases: { ...p.aliases, [k]: [...cur, w] } };
}

/** Retire d'un profil les corrections dangereuses apprises par les versions précédentes (un mot très courant seul : « pas », « avec »…). */
export function sanitizeProfile(p: VoiceProfile): VoiceProfile {
  const bad = Object.keys(p.wordFixes).filter((k) => !k.includes(' ') && COMMON.has(k));
  if (!bad.length) return p;
  const wordFixes = { ...p.wordFixes };
  for (const k of bad) delete wordFixes[k];
  return { ...p, wordFixes };
}

export interface SharedEntry { kind: 'alias' | 'fix'; key: string; value: string }

/** Ce que `next` contient de plus que `base` (nouvelles variantes de prénoms et corrections de mots). */
export function profileDelta(base: VoiceProfile, next: VoiceProfile): SharedEntry[] {
  const out: SharedEntry[] = [];
  for (const [k, list] of Object.entries(next.aliases)) for (const v of list) if (!(base.aliases[k] ?? []).includes(v)) out.push({ kind: 'alias', key: k, value: v });
  for (const [k, v] of Object.entries(next.wordFixes)) if (base.wordFixes[k] !== v) out.push({ kind: 'fix', key: k, value: v });
  return out;
}

/** Profil effectif : apprentissages communs du club, complétés (et corrigés) par le profil personnel. */
export function mergeProfiles(shared: VoiceProfile, mine: VoiceProfile): VoiceProfile {
  const aliases: Record<string, string[]> = { ...shared.aliases };
  for (const [k, list] of Object.entries(mine.aliases)) aliases[k] = Array.from(new Set([...(aliases[k] ?? []), ...list]));
  return { aliases, wordFixes: { ...shared.wordFixes, ...mine.wordFixes }, calibratedAt: mine.calibratedAt };
}

// ───────────────────────── Phrases à lire ─────────────────────────

export interface CalPrompt { group: string; text: string; opts?: ParseOpts }
export interface CalSetup { players: VoicePlayer[]; court: string[]; bench: string[]; ctx: ParseCtx }

/** Terrain fictif du calibrage : 5 premières joueuses nommées sur le terrain, les autres au banc. */
export function calibrationSetup(all: VoicePlayer[]): CalSetup {
  const players = all.filter((p) => p.name);
  const court = players.slice(0, 5).map((p) => p.id);
  const bench = players.slice(5).map((p) => p.id);
  return {
    players, court, bench,
    ctx: { onCourt: court, requireOnCourt: true, events: court.length ? [{ id: 'cal-1', actionType: 'TIR 2PTS RÉUSSI', playerId: court[0], period: 1 }] : [] },
  };
}

const cap = (n: string) => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();

export function buildPrompts(setup: CalSetup): CalPrompt[] {
  const { players, court, bench } = setup;
  const nm = (id: string) => cap(players.find((p) => p.id === id)?.name ?? '');
  const num = (id: string) => players.find((p) => p.id === id)?.number;
  const C = (i: number) => nm(court[i % Math.max(1, court.length)]);
  const B = (i: number) => (bench.length ? nm(bench[i % bench.length]) : C(i + 2));
  const out: CalPrompt[] = [];
  // 1) chaque prénom, avec une action différente (sur le terrain) ; les joueuses du banc par un remplacement (seule façon valable pour elles)
  const acts = ['deux points', 'interception', 'passe décisive', 'rebond défensif', 'trois points', 'faute de'];
  court.forEach((id, i) => {
    const a = acts[i % acts.length];
    out.push({ group: 'Prénoms', text: a === 'faute de' ? `faute de ${nm(id)}` : `${nm(id)} ${a}` });
  });
  bench.slice(0, 11).forEach((id, i) => out.push({ group: 'Prénoms (banc)', text: `remplacement ${C(i)} par ${nm(id)}` }));
  // 2) numéros de maillot
  const uniq = court.filter((id) => players.filter((p) => p.number === num(id)).length === 1);   // numéros portés par une seule joueuse
  const jn = (i: number) => num(uniq[i % Math.max(1, uniq.length)]);
  if (uniq.length) {
    out.push({ group: 'Numéros', text: `deux points la ${jn(0)}` }, { group: 'Numéros', text: `faute de la ${jn(1)}` }, { group: 'Numéros', text: `sélectionne le ${jn(2)}` });
  }
  // 3) actions
  const A: Array<[string, number]> = [
    ['faute sur', 0], ['faute de', 1], ['faute technique', 2], ['faute antisportive', 3], ['perte de balle de', 4], ['balle perdue', 0], ['interception', 1],
    ['rebond offensif', 2], ['rebond défensif', 3], ['passe décisive', 4], ['contre de', 0], ['tir à 2 points manqué', 1], ['raté à 3 points pour', 2], ['tir à 3 points réussi', 3],
  ];
  A.forEach(([w, i]) => out.push({ group: 'Actions', text: `${w} ${C(i)}` }));
  out.push({ group: 'Actions', text: `${C(1)} contrée` }, { group: 'Actions', text: `contre subi ${C(2)}` }, { group: 'Actions', text: `sélectionne ${C(3)}` });
  // 4) lancers francs
  out.push({ group: 'Lancers francs', text: `lancer franc ${C(0)}` }, { group: 'Lancers francs', text: 'premier réussi', opts: { ftSession: true } },
    { group: 'Lancers francs', text: 'deuxième raté', opts: { ftSession: true } }, { group: 'Lancers francs', text: 'terminé', opts: { ftSession: true } },
    { group: 'Lancers francs', text: `${C(2)} 1/3` }, { group: 'Lancers francs', text: `lancers francs ${C(3)} deux sur trois` });
  // 5) changements
  if (court.length >= 2) {
    out.push({ group: 'Changements', text: `remplacement ${C(0)}, ${C(1)} par ${B(0)}, ${B(1)}` }, { group: 'Changements', text: `sortie de ${C(2)} entrée de ${B(2)}` });
    if (court.length === 5 && bench.length) out.push({ group: 'Changements', text: `sur le terrain on a ${B(0)}, ${C(1)}, ${C(2)}, ${C(3)}, ${C(4)}` });
  }
  out.push({ group: 'Changements', text: 'afficher changement' }, { group: 'Changements', text: 'valider changement' }, { group: 'Changements', text: 'fermer' });
  // 6) chrono et match
  ['démarrer chrono', 'arrêt chrono', 'démarrer le match', 'reprise du jeu', 'temps mort'].forEach((t) => out.push({ group: 'Chrono', text: t }));
  // 7) divers
  out.push({ group: 'Divers', text: 'annule la dernière commande' }, { group: 'Divers', text: `annule dernière action ${C(0)}` }, { group: 'Divers', text: 'adversaire deux points' },
    { group: 'Divers', text: 'adversaire moins un' }, { group: 'Divers', text: 'score' }, { group: 'Divers', text: 'qui est sur le terrain' },
    { group: 'Divers', text: `combien de fautes ${C(1)}` }, { group: 'Divers', text: 'fautes équipe' });
  return out.filter((p) => !/\b(undefined|NaN)\b/.test(p.text) && !/ $/.test(p.text));
}

// ───────────────────────── Évaluation et apprentissage ─────────────────────────

/** Empreinte d'une commande : deux phrases qui donnent la même empreinte ont le même effet. */
export function cmdKey(c: Cmd): string {
  switch (c.type) {
    case 'EVENT': return `EVENT|${c.playerId}|${c.action}`;
    case 'FREE_THROWS': return `FT|${c.playerId}|${c.made}/${c.attempts}`;
    case 'FT_START': return `FTS|${c.playerId}`;
    case 'FT_ATTEMPT': return `FTA|${c.index}|${c.made}`;
    case 'FT_RATIO': return `FTR|${c.made}/${c.attempts}`;
    case 'SUB': return `SUB|${[...c.outs].sort().join(',')}|${[...c.ins].sort().join(',')}`;
    case 'SET_COURT': return `SET|${[...c.ins].sort().join(',')}`;
    case 'CLOCK': return `CLOCK|${c.running}`;
    case 'SELECT': return `SEL|${c.playerId}`;
    case 'SUBPANEL': return `PANEL|${c.op}`;
    case 'OPP': return `OPP|${c.delta}`;
    case 'UNDO': return `UNDO|${c.playerId ?? ''}|${c.eventId ?? ''}`;
    case 'Q_FOULS': return `QF|${c.playerId}`;
    default: return `${c.type}|${'say' in c ? c.say : ''}`;
  }
}

/** Résumé lisible de ce que l'appli a compris (pour comparer « attendu » et « entendu » au calibrage). */
export function describeCmd(c: Cmd, players: VoicePlayer[]): string {
  const nm = (id: string | null | undefined) => { const p = players.find((x) => x.id === id); return p ? (p.name ? p.name.charAt(0) + p.name.slice(1).toLowerCase() : `n°${p.number}`) : '?'; };
  switch (c.type) {
    case 'EVENT': return `${c.action} · ${nm(c.playerId)}`;
    case 'FREE_THROWS': return `lancers francs ${c.made}/${c.attempts} · ${nm(c.playerId)}`;
    case 'FT_START': return `série de lancers francs · ${nm(c.playerId)}`;
    case 'FT_ATTEMPT': return `tentative ${c.index === null ? 'suivante' : (c.index ?? 0) + 1} ${c.made ? 'réussie' : 'ratée'}`;
    case 'FT_DONE': return 'fin de série';
    case 'FT_RATIO': return `lancers francs ${c.made}/${c.attempts}`;
    case 'SUB': return `changement : sortent ${c.outs.map(nm).join(', ')} ; entrent ${c.ins.map(nm).join(', ')}`;
    case 'SET_COURT': return `cinq sur le terrain : ${c.ins.map(nm).join(', ')}`;
    case 'CLOCK': return c.running ? 'chrono : démarrer' : 'chrono : arrêter';
    case 'SELECT': return c.playerId ? `sélection · ${nm(c.playerId)}` : 'désélection';
    case 'SUBPANEL': return `fenêtre de changement : ${c.op}`;
    case 'OPP': return `score adverse ${c.delta > 0 ? '+' : ''}${c.delta}`;
    case 'UNDO': return `annulation${c.playerId ? ' · ' + nm(c.playerId) : ''}`;
    case 'Q_FOULS': return `question fautes · ${nm(c.playerId)}`;
    case 'ASK': return `question de l'appli : ${c.say}`;
    case 'REFUSE': return `refus : ${c.say}`;
    case 'UNKNOWN': return 'non reconnu';
    default: return c.type;
  }
}

export interface CalDetail {
  expected: string;
  perAlt: Array<{ alt: string; ok: boolean; understood: string }>;
  learned: SharedEntry[];
}

export type CalStatus = 'ok' | 'learned' | 'fail';
export interface CalResult { status: CalStatus; heard: string; profile: VoiceProfile; detail: CalDetail }

const isBad = (c: Cmd) => c.type === 'UNKNOWN' || c.type === 'REFUSE';

/** Découpe en segments qui diffèrent (plus longue sous-suite commune), mots attendus vs mots entendus. */
interface Seg { e: string[]; h: string[]; i: number; j: number }
function diffSegments(E: string[], H: string[]): Seg[] {
  const n = E.length, m = H.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = E[i] === H[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const segs: Seg[] = [];
  let i = 0, j = 0, cur: Seg = { e: [], h: [], i: 0, j: 0 };
  const flush = () => { if (cur.e.length || cur.h.length) segs.push(cur); cur = { e: [], h: [], i, j }; };
  while (i < n && j < m) {
    if (E[i] === H[j]) { flush(); i++; j++; cur = { e: [], h: [], i, j }; }
    else if (L[i + 1][j] >= L[i][j + 1]) cur.e.push(E[i++]);
    else cur.h.push(H[j++]);
  }
  while (i < n) cur.e.push(E[i++]);
  while (j < m) cur.h.push(H[j++]);
  flush();
  return segs;
}

// Mots très courants du français : jamais appris seuls (« pas » → « passe » casserait toutes les phrases avec « pas »).
// Dans ce cas on apprend la tournure avec son voisin (« pas décisive » → « passe décisive »).
const COMMON = new Set(['pas', 'avec', 'dans', 'pour', 'par', 'votre', 'vous', 'nous', 'mais', 'donc', 'ces', 'ses', 'sur', 'sous', 'une', 'des', 'les', 'aux', 'est', 'sont', 'que', 'qui', 'quoi', 'comme', 'plus',
  'moins', 'tres', 'bien', 'tout', 'tous', 'elle', 'il', 'ils', 'on', 'ca', 'ce', 'cet', 'cette', 'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'la', 'le', 'de', 'du', 'un', 'et', 'ou', 'ni', 'si', 'se', 'ne', 'en', 'au',
  'a', 'y', 'merci', 'oui', 'non', 'ok', 'alors', 'puis', 'faire', 'fait', 'deja', 'aussi', 'encore', 'sans', 'chez', 'entre', 'vers', 'ici', 'voila', 'bon', 'ben', 'bah', 'euh', 'allez', 'cest', 'sest', 'moi', 'toi', 'lui', 'leur', 'eux', 'nos', 'vos', 'mes', 'tes', 'ses']);

/** Ce qu'on peut apprendre d'un écart entre la phrase lue et la phrase entendue. */
export function learnFrom(expected: string, heard: string, players: VoicePlayer[], p: VoiceProfile): VoiceProfile {
  let next = p;
  const names = new Map(players.filter((x) => x.name).map((x) => [strip(x.name), x.name]));
  const E = toDigitsText(expected).split(' ').filter(Boolean);
  const H = toDigitsText(heard).split(' ').filter(Boolean);
  const segs = diffSegments(E, H);
  // Garde-fou : on n'apprend que si une partie de la phrase attendue a été entendue telle quelle (un « merci à bientôt » sans rapport n'apprend rien).
  const matched = E.length - segs.reduce((n, g) => n + g.e.length, 0);
  if (matched < 1 || matched * 3 < E.length) return p;
  const setFix = (h: string, e: string) => { if (next.wordFixes[h] === undefined) next = { ...next, wordFixes: { ...next.wordFixes, [h]: e } }; };   // jamais d'écrasement
  for (const raw of segs) {
    let seg = raw;
    // mot courant isolé : on l'apprend avec un voisin identique des deux côtés, sinon on ne l'apprend pas
    if (seg.h.length === 1 && COMMON.has(seg.h[0])) {
      const ne = E[seg.i + seg.e.length], nh = H[seg.j + seg.h.length];
      const pe = E[seg.i - 1], ph = H[seg.j - 1];
      if (ne !== undefined && ne === nh) seg = { ...seg, e: [...seg.e, ne], h: [...seg.h, nh] };
      else if (pe !== undefined && pe === ph) seg = { ...seg, e: [pe, ...seg.e], h: [ph, ...seg.h], i: seg.i - 1, j: seg.j - 1 };
      else continue;
    }
    if (!seg.e.length || !seg.h.length || seg.e.length > 3 || seg.h.length > 3) continue;
    const e = seg.e.join(' '), h = seg.h.join(' ');
    if (h.length < 2 || e === h) continue;
    const nameKey = Array.from(names.keys()).find((k) => k === e || k === seg.e.join(''));
    // Les mots qui déclenchent déjà une commande ou un nombre ne sont jamais remplacés. Les petits mots (« un », « de », « à »…) peuvent faire partie d'une correction.
    const hasMeaning = raw.h.some((w) => isCommandWord(w) && !/^\d+$/.test(w));   // le voisin ajouté pour le contexte, lui, peut être un mot de commande
    const hasDigit = raw.h.some((w) => /^\d+$/.test(w));
    if (nameKey) {
      // Un prénom entendu comme « en 10 » ou « à lire » : avec chiffres ou petits mots, la variante est remplacée avant l'analyse (correction de mots) ; sinon variante de prénom.
      const plain = seg.h.every((w) => !/^\d+$/.test(w) && w.length >= 2);
      if (plain && !hasMeaning && seg.h.length === 1) next = addAliasTo(next, names.get(nameKey) as string, h);
      else if (!hasMeaning) setFix(h, e);
      continue;
    }
    if (hasMeaning || hasDigit) continue;
    setFix(h, e);
  }
  return next;
}

/** Une phrase lue : le navigateur a renvoyé ces alternatives (la plus probable d'abord). */
export function evaluateHeard(prompt: CalPrompt, alts: string[], setup: CalSetup, profile: VoiceProfile): CalResult {
  const ctxWith = (pr: VoiceProfile): ParseCtx => ({ ...setup.ctx, wordFixes: pr.wordFixes });
  const players = (pr: VoiceProfile): VoicePlayer[] => setup.players.map((pl) => ({ ...pl, aliases: [...(pl.aliases ?? []), ...(pr.aliases[strip(pl.name)] ?? [])] }));
  const parse = (a: string, pr: VoiceProfile) => parseCommand(a, players(pr), ctxWith(pr), prompt.opts);
  const expected = parse(prompt.text, profile);
  const heard = alts[0] ?? '';
  const key = cmdKey(expected);
  const detailFor = (pr: VoiceProfile, learned: SharedEntry[]): CalDetail => ({
    expected: describeCmd(expected, setup.players),
    perAlt: alts.map((a) => { const c = parse(a, pr); return { alt: a, ok: !isBad(expected) && cmdKey(c) === key, understood: describeCmd(c, setup.players) }; }),
    learned,
  });
  if (isBad(expected)) return { status: 'ok', heard, profile, detail: detailFor(profile, []) };   // phrase non évaluable dans ce contexte : on ne pénalise pas
  const matches = (pr: VoiceProfile, list: string[]) => list.some((a) => cmdKey(parse(a, pr)) === key);
  if (matches(profile, alts)) return { status: 'ok', heard, profile, detail: detailFor(profile, []) };
  // apprentissage à partir de chaque alternative, de la plus probable à la moins probable
  // (on ne retient que l'apprentissage d'UNE alternative qui suffit à comprendre la phrase : pas de pollution par les autres)
  for (const a of alts) {
    const cand = learnFrom(prompt.text, a, setup.players, profile);
    if (cand !== profile && matches(cand, alts)) return { status: 'learned', heard, profile: cand, detail: detailFor(cand, profileDelta(profile, cand)) };
  }
  return { status: 'fail', heard, profile, detail: detailFor(profile, []) };
}
