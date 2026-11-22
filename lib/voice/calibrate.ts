// lib/voice/calibrate.ts — logique pure du calibrage de la commande vocale (testable sans navigateur ni base) :
// liste de phrases à lire, évaluation de ce que le navigateur a entendu, apprentissage des écarts.
// Pas d'audio : seulement du texte (variantes de prénoms, corrections de mots).

import { Cmd, ParseCtx, ParseOpts, VoicePlayer, isLexiconWord, parseCommand, strip } from './commands';

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
  // 1) chaque prénom, avec une action différente
  const acts = ['deux points', 'interception', 'passe décisive', 'rebond défensif', 'trois points', 'faute de'];
  players.slice(0, 16).forEach((p, i) => {
    const a = acts[i % acts.length];
    out.push({ group: 'Prénoms', text: a === 'faute de' ? `faute de ${cap(p.name)}` : `${cap(p.name)} ${a}` });
  });
  // 2) numéros de maillot
  const jn = (i: number) => num(court[i % Math.max(1, court.length)]);
  if (court.length) {
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

export type CalStatus = 'ok' | 'learned' | 'fail';
export interface CalResult { status: CalStatus; heard: string; profile: VoiceProfile }

const isBad = (c: Cmd) => c.type === 'UNKNOWN' || c.type === 'REFUSE';

/** Découpe en segments qui diffèrent (plus longue sous-suite commune), mots attendus vs mots entendus. */
function diffSegments(E: string[], H: string[]): Array<{ e: string[]; h: string[] }> {
  const n = E.length, m = H.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = E[i] === H[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const segs: Array<{ e: string[]; h: string[] }> = [];
  let i = 0, j = 0, cur = { e: [] as string[], h: [] as string[] };
  const flush = () => { if (cur.e.length || cur.h.length) segs.push(cur); cur = { e: [], h: [] }; };
  while (i < n && j < m) {
    if (E[i] === H[j]) { flush(); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) cur.e.push(E[i++]);
    else cur.h.push(H[j++]);
  }
  while (i < n) cur.e.push(E[i++]);
  while (j < m) cur.h.push(H[j++]);
  flush();
  return segs;
}

/** Ce qu'on peut apprendre d'un écart entre la phrase lue et la phrase entendue. */
export function learnFrom(expected: string, heard: string, players: VoicePlayer[], p: VoiceProfile): VoiceProfile {
  let next = p;
  const names = new Map(players.filter((x) => x.name).map((x) => [strip(x.name), x.name]));
  for (const seg of diffSegments(strip(expected).split(' ').filter(Boolean), strip(heard).split(' ').filter(Boolean))) {
    if (!seg.e.length || !seg.h.length || seg.e.length > 3 || seg.h.length > 3) continue;
    const e = seg.e.join(' '), h = seg.h.join(' ');
    if (h.length < 2 || e === h) continue;
    const nameKey = Array.from(names.keys()).find((k) => k === e || k === seg.e.join(''));
    if (nameKey) { next = addAliasTo(next, names.get(nameKey) as string, h); continue; }
    if (seg.h.some((w) => isLexiconWord(w))) continue;           // ne jamais « corriger » un mot qui a déjà un sens
    next = { ...next, wordFixes: { ...next.wordFixes, [h]: e } };
  }
  return next;
}

/** Une phrase lue : le navigateur a renvoyé ces alternatives (la plus probable d'abord). */
export function evaluateHeard(prompt: CalPrompt, alts: string[], setup: CalSetup, profile: VoiceProfile): CalResult {
  const ctxWith = (pr: VoiceProfile): ParseCtx => ({ ...setup.ctx, wordFixes: pr.wordFixes });
  const players = (pr: VoiceProfile): VoicePlayer[] => setup.players.map((pl) => ({ ...pl, aliases: [...(pl.aliases ?? []), ...(pr.aliases[strip(pl.name)] ?? [])] }));
  const expected = parseCommand(prompt.text, players(profile), ctxWith(profile), prompt.opts);
  const heard = alts[0] ?? '';
  if (isBad(expected)) return { status: 'ok', heard, profile };           // phrase non évaluable dans ce contexte : on ne pénalise pas
  const key = cmdKey(expected);
  const matches = (pr: VoiceProfile, list: string[]) => list.some((a) => cmdKey(parseCommand(a, players(pr), ctxWith(pr), prompt.opts)) === key);
  if (matches(profile, alts)) return { status: 'ok', heard, profile };
  // apprentissage à partir de chaque alternative, de la plus probable à la moins probable
  // (on ne retient que l'apprentissage d'UNE alternative qui suffit à comprendre la phrase : pas de pollution par les autres)
  for (const a of alts) {
    const cand = learnFrom(prompt.text, a, setup.players, profile);
    if (cand !== profile && matches(cand, alts)) return { status: 'learned', heard, profile: cand };
  }
  return { status: 'fail', heard, profile };
}
