// lib/voice/tutorial.ts — match de démonstration et parcours guidé (≈ 50 étapes) de la commande vocale.
// Pur et testable : chaque étape donne la phrase à dire, ce qui doit se passer, et comment le vérifier.

export interface DemoPlayer { id: string; name: string; number: number }
export interface DemoMatch {
  opponent: string;
  players: DemoPlayer[];
  /** Les cinq de départ (à annoncer à la voix : le terrain est vide au début du didacticiel). */
  court: string[];
  /** Joueuses restées au numéro 0 (valeur par défaut) → numéro à leur affecter à la voix. */
  newNumbers: Record<string, number>;
}

const OPPONENTS = ['ASVEL BASKET', 'VILLEURBANNE BASKET', 'LYON FÉMININ BASKET', 'BOURG BASKET', 'RILLIEUX BASKET', 'OULLINS BASKET', 'CALUIRE BASKET', 'VÉNISSIEUX BASKET', 'GIVORS BASKET', 'MEYZIEU BASKET'];
// Prénoms qui se prononcent nettement différemment (pas de paires du type Anna / Anaïs) : le didacticiel ne doit pas se tromper.
const NAMES = ['LÉA', 'MANON', 'CAMILLE', 'JADE', 'ZOÉ', 'EMMA', 'LINA', 'SARAH', 'OCÉANE', 'MAËLLE', 'CLARA', 'NORA', 'LOUISE', 'EVA', 'LOLA', 'JULIE', 'ROMANE', 'LUCIE', 'MARGAUX', 'ÉLODIE', 'PAULINE', 'MATHILDE', 'ALICE', 'FLORA'];

const shuffle = <T,>(a: T[], rnd: () => number): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

/**
 * SATHONAY contre une équipe au hasard : 10 joueuses (prénoms et numéros au hasard), dont 4 restées au numéro 0
 * comme dans la vraie vie (il faut leur affecter un numéro), et 5 de départ au hasard (terrain vide au début).
 */
export function makeDemo(rnd: () => number = Math.random): DemoMatch {
  const names = shuffle(NAMES, rnd).slice(0, 10);
  const numbers = shuffle(Array.from({ length: 30 }, (_, i) => i + 1), rnd);
  const base = names.map((name, i) => ({ id: `demo-${i + 1}`, name, number: numbers[i] }));
  const zeroIds = shuffle(base.map((p) => p.id), rnd).slice(0, 4);
  const newNumbers: Record<string, number> = {};
  zeroIds.forEach((id, i) => { newNumbers[id] = numbers[10 + i]; });
  const players = base.map((p) => (zeroIds.includes(p.id) ? { ...p, number: 0 } : p)).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const courtIds = new Set(shuffle(players.map((p) => p.id), rnd).slice(0, 5));
  return {
    opponent: OPPONENTS[Math.floor(rnd() * OPPONENTS.length)],
    players,
    court: players.filter((p) => courtIds.has(p.id)).map((p) => p.id),
    newNumbers,
  };
}

/** Photo de l'écran à un instant : sert à vérifier qu'une commande a eu son effet. */
export interface TutSnap {
  events: Array<{ actionType: string; playerId: string }>;   // le plus récent en premier
  scoreHome: number;
  scoreAway: number;
  clockRunning: boolean;
  clockSeconds: number;
  onCourt: string[];
  numbers: Record<string, number>;
  selected: string | null;
  subPanelOpen: boolean;
  ftFilled: number;
  voiceEnabled: boolean;
}
/** Dernière réponse de la commande vocale (texte dit, actions exécutées). */
export interface TutLast { say: string; actions: number; at: number }
export interface TutCheck { cur: TutSnap; base: TutSnap; last: TutLast | null }
export interface TutStep {
  section: string;
  /** Phrase à dire (peut dépendre de l'état courant). '' : étape manuelle. */
  say: string | ((c: TutCheck) => string);
  /** Autres façons de dire la même chose (affichées sous la phrase : au choix). */
  alts?: string[];
  /** Ce qui se passe, en une phrase. */
  why: string;
  /** Texte d'introduction (début de phase, explication). */
  intro?: string;
  /** Affiche deux boutons pour écouter le bip « fait » et les 2 bips « non reconnu ». */
  beeps?: boolean;
  check: (c: TutCheck) => boolean;
}

const lastEv = (c: TutCheck) => c.cur.events.find((e) => !e.actionType.startsWith('REMPLACEMENT'));
const added = (c: TutCheck) => c.cur.events.length > c.base.events.length;
const ev = (act: string, pid: string) => (c: TutCheck) => added(c) && lastEv(c)?.actionType === act && lastEv(c)?.playerId === pid;
const saysRe = (re: RegExp) => (c: TutCheck) => !!c.last && re.test(c.last.say);
/** Phrase comprise mais refusée (2 bips) : rien n'a été fait. */
const refusedRe = (re: RegExp) => (c: TutCheck) => !!c.last && c.last.actions === 0 && re.test(c.last.say);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Toutes les actions de joueuse : une façon de les dire par le prénom, une autre par le numéro. */
interface Act { act: string; label: string; byName: (n: string) => string; byNum: (k: number) => string }
const ACTS: Act[] = [
  { act: 'TIR 2PTS RÉUSSI', label: 'Tir à 2 points réussi', byName: (n) => `${n} deux points`, byNum: (k) => `deux points la ${k}` },
  { act: 'TIR 3PTS RÉUSSI', label: 'Tir à 3 points réussi', byName: (n) => `trois points pour ${n}`, byNum: (k) => `trois points la ${k}` },
  { act: 'TIR 2PTS Manqué', label: 'Tir à 2 points manqué', byName: (n) => `raté à deux points pour ${n}`, byNum: (k) => `tir à deux points manqué la ${k}` },
  { act: 'TIR 3PTS Manqué', label: 'Tir à 3 points manqué', byName: (n) => `tir à trois points manqué ${n}`, byNum: (k) => `raté à trois points la ${k}` },
  { act: 'REBOND OFFENSIF', label: 'Rebond offensif', byName: (n) => `rebond offensif ${n}`, byNum: (k) => `rebond offensif la ${k}` },
  { act: 'REBOND DÉFENSIF', label: 'Rebond défensif', byName: (n) => `rebond défensif ${n}`, byNum: (k) => `rebond défensif la ${k}` },
  { act: 'PASSE DÉCISIVE', label: 'Passe décisive', byName: (n) => `passe décisive ${n}`, byNum: (k) => `passe décisive la ${k}` },
  { act: 'INTERCEPTION', label: 'Interception', byName: (n) => `interception ${n}`, byNum: (k) => `interception la ${k}` },
  { act: 'PERTE DE BALLE', label: 'Perte de balle', byName: (n) => `perte de balle de ${n}`, byNum: (k) => `balle perdue la ${k}` },
  { act: 'CONTRE', label: 'Contre (la joueuse contre un tir adverse)', byName: (n) => `contre de ${n}`, byNum: (k) => `contre de la ${k}` },
  { act: 'CONTRE SUBI', label: 'Contre subi (son tir est contré)', byName: (n) => `${n} contrée`, byNum: (k) => `contre subi la ${k}` },
  { act: 'FAUTE PERSONNELLE', label: 'Faute personnelle (« faute de » = qui la commet)', byName: (n) => `faute de ${n}`, byNum: (k) => `faute de la ${k}` },
  { act: 'FAUTE SUBIE', label: 'Faute subie (« faute sur » = qui la subit)', byName: (n) => `faute sur ${n}`, byNum: (k) => `faute sur la ${k}` },
  { act: 'FAUTE TECHNIQUE', label: 'Faute technique', byName: (n) => `faute technique ${n}`, byNum: (k) => `faute technique la ${k}` },
  { act: 'FAUTE ANTISPORTIVE', label: 'Faute antisportive', byName: (n) => `faute antisportive ${n}`, byNum: (k) => `faute antisportive la ${k}` },
];

export function buildTutorial(demo: DemoMatch, rnd: () => number = Math.random): TutStep[] {
  const { players, court, newNumbers } = demo;
  const cap = (n: string) => n.charAt(0) + n.slice(1).toLowerCase();
  const by = (id: string) => players.find((p) => p.id === id) as DemoPlayer;
  const num = (p: DemoPlayer) => newNumbers[p.id] ?? p.number;           // numéro une fois la feuille corrigée
  const n = (p: DemoPlayer) => cap(p.name);
  const bench = players.filter((p) => !court.includes(p.id)).map((p) => p.id);
  const [A, B, C, D, E] = court.map(by), [F, G] = bench.slice(0, 2).map(by);
  const zeros = players.filter((p) => p.number === 0);
  const S: TutStep[] = [];
  const add = (section: string, say: TutStep['say'], why: string, check: TutStep['check'], extra: Partial<TutStep> = {}) => S.push({ section, say, why, check, ...extra });

  // ───────── 1 · Activer la voix, les deux sons
  const s1 = '1 · Activer la voix';
  add(s1, '', "Vous gardez la main : la voix ne s'active que quand vous le décidez.", (c) => c.cur.voiceEnabled,
    { intro: "Mettez votre casque, puis touchez le bouton « COMMANDE VOCALE : COUPÉE » en haut de l'écran : il devient vert. Autorisez le micro si le navigateur le demande. Le mode DIRECT (par défaut) écoute et agit : pas de question, pas de voix, seulement des bips." });
  add(s1, 'interception', "Il manque la joueuse : l'appli ne pose AUCUNE question, elle refuse tout de suite avec 2 bips graves. Redites simplement la phrase en entier.", refusedRe(/Quelle joueuse/),
    { beeps: true, intro: "Deux sons à retenir : 1 bip aigu = commande effectuée ✓. 2 bips graves = commande non reconnue ou impossible, rien n'a été fait. Essayez : dites une phrase incomplète, sans joueuse." });
  add(s1, `sélectionne ${n(A)}`, `1 bip : ${n(A)} est sélectionnée à l'écran, comme si vous la touchiez. Sans nom, l'action suivante irait à elle.`, (c) => c.cur.selected === A.id);

  // ───────── 2 · Avant le coup d'envoi : les numéros
  const s2 = '2 · Avant le coup d\'envoi : numéros';
  add(s2, 'contrôle numéros joueuses', `Les joueuses restées au numéro 0 sont nommées (${zeros.map(n).join(', ')}) : 2 bips, il faut leur donner un numéro.`, refusedRe(/^Numéro 0 :/),
    { alts: ['vérifie les numéros', 'contrôle des numéros'], intro: "Avant le coup d'envoi, deux commandes servent à régler la feuille de match : donner un numéro à une joueuse, et contrôler que tous les numéros sont différents. Elles ne marchent plus une fois le match commencé." });
  const forms = (name: string, k: number) => [`${name} a le numéro ${k}`, `${name} prend le ${k}`, `${name} porte le numéro ${k}`, `${name} a le ${k}`];
  zeros.forEach((z, i) => {
    const f = forms(n(z), newNumbers[z.id]);
    add(s2, f[i % 4], `${n(z)} reçoit le numéro ${newNumbers[z.id]} (feuille de match et joueuses du match). 1 bip.`, (c) => c.cur.numbers[z.id] === newNumbers[z.id],
      { alts: f.filter((_, j) => j !== i % 4) });
  });
  add(s2, 'contrôle numéros joueuses', 'Tous les numéros sont différents : 1 bip, « Numéros tous différents ».', saysRe(/tous différents/), { alts: ['vérifie les numéros'] });

  // ───────── 3 · Les cinq de départ
  const s3 = '3 · Les cinq de départ';
  const startList = court.map((id) => n(by(id))).join(', ');
  add(s3, `sur le terrain on a ${startList}`, 'Les cinq de départ sont affichés sur le terrain. Aucun changement n\'est enregistré : le match n\'a pas commencé.', (c) => sameSet(c.cur.onCourt, court),
    { alts: [`sur le terrain on a ${court.map((id) => `la ${num(by(id))}`).join(', ')}`, `en jeu ${startList}`], intro: "Annoncez les cinq joueuses qui commencent : par leur prénom ou par leur numéro, dans n'importe quel ordre." });

  // ───────── 4 · Coup d'envoi
  const s4 = "4 · Coup d'envoi";
  add(s4, 'démarrer le match', 'Le chronomètre du match tourne.', (c) => c.cur.clockRunning, { alts: ['démarrer chrono', "coup d'envoi", 'début du match'] });

  // ───────── 5 · Premières actions, au hasard (une fois par le prénom, une fois par le numéro)
  const pool = shuffle(ACTS, rnd);
  let turn = 0;
  const actStep = (section: string, a: Act, onCourt: DemoPlayer[]) => {
    const p = onCourt[Math.floor(rnd() * onCourt.length)];
    const byNum = turn++ % 2 === 1;
    const say = byNum ? a.byNum(num(p)) : a.byName(n(p));
    const other = byNum ? a.byName(n(p)) : a.byNum(num(p));
    add(section, say, `${a.label} de ${n(p)}${byNum ? ` (la ${num(p)})` : ''}. 1 bip.`, ev(a.act, p.id), { alts: [other] });
  };
  const courtNow = [A, B, C, D, E];
  const s5 = '5 · Premières actions';
  pool.slice(0, 6).forEach((a, i) => {
    if (i === 0) turn = 0;
    actStep(s5, a, courtNow);
  });
  S[S.length - 6].intro = "Le match est lancé : à vous. On alterne : une fois avec le prénom, une fois avec le numéro de la joueuse (« la 7 »). L'ordre des mots est libre.";

  // ───────── 6 · Temps mort : arrêter, repositionner le chrono, changements
  const s6 = '6 · Temps mort';
  add(s6, 'arrêt chrono', "Le chronomètre s'arrête (temps mort, faute, ballon sorti…).", (c) => !c.cur.clockRunning && c.base.clockRunning,
    { alts: ['temps mort', 'arrêt de jeu'], intro: 'Le jeu est arrêté : on en profite pour remettre le chrono à la bonne valeur et faire des changements.' });
  const m = 4 + Math.floor(rnd() * 5), sec = [15, 30, 45][Math.floor(rnd() * 3)];
  add(s6, `mettre chrono à ${m} minutes et ${sec} secondes`, `Le chrono affiche ${m}:${String(sec).padStart(2, '0')}. Valable à tout moment du match ; le chrono reste arrêté.`, (c) => c.cur.clockSeconds === m * 60 + sec && !c.cur.clockRunning,
    { alts: [`mets le chrono à ${m} minutes ${sec}`, `chrono ${m} minutes et ${sec} secondes`, `mettre chrono à ${m} minutes`] });
  add(s6, `remplacement ${n(A)} par ${n(F)}`, `${n(F)} entre, ${n(A)} sort : le terrain est mis à jour tout de suite (pas de « oui » à dire ; une erreur se corrige par un nouveau changement).`, (c) => c.cur.onCourt.includes(F.id) && !c.cur.onCourt.includes(A.id),
    { alts: [`sortie de ${n(A)} entrée de ${n(F)}`, `remplacement la ${num(A)} par la ${num(F)}`] });
  add(s6, `sortie de ${n(B)} entrée de ${n(G)}`, `Deuxième façon de dire un changement (plusieurs joueuses possibles à la fois) : ${n(G)} entre, ${n(B)} sort.`, (c) => c.cur.onCourt.includes(G.id) && !c.cur.onCourt.includes(B.id),
    { alts: [`remplacement ${n(B)} par ${n(G)}`] });
  add(s6, (c) => `sur le terrain on a ${[...c.cur.onCourt.filter((id) => id !== C.id).map((id) => n(by(id))), n(A)].join(', ')}`,
    `Troisième façon : citez les cinq qui sont sur le terrain, l'appli déduit qui sort (${n(C)}) et qui entre (${n(A)}).`, (c) => c.cur.onCourt.includes(A.id) && !c.cur.onCourt.includes(C.id));
  add(s6, 'afficher changement', "La fenêtre de changement s'affiche à l'écran (pour choisir à la main).", (c) => c.cur.subPanelOpen, { alts: ['ouvrir changement'] });
  add(s6, 'fermer', 'La fenêtre se ferme.', (c) => !c.cur.subPanelOpen, { alts: ['annuler changement'] });

  // ───────── 7 · Reprise
  const s7 = '7 · Reprise du jeu';
  add(s7, 'reprise du jeu', 'Le chronomètre repart.', (c) => c.cur.clockRunning && !c.base.clockRunning, { alts: ['démarrer chrono', 'reprise'] });

  // ───────── 8 · Suite du match : toutes les autres actions, au hasard
  const s8 = '8 · Suite du match';
  const courtAfter = [F, G, D, E, A];
  pool.slice(6).forEach((a, i) => {
    actStep(s8, a, courtAfter);
    if (i === 0) S[S.length - 1].intro = "Le match continue : les autres actions, toujours en alternant prénom et numéro. Vous en connaîtrez ainsi toutes les façons de les dire.";
  });
  add(s8, `${n(F)} a le numéro 12`, "Les numéros ne se changent plus : le match a commencé. 2 bips, rien n'est modifié.", refusedRe(/avant le match/));
  add(s8, `sélectionne ${n(A)}`, `${n(A)} est sélectionnée à l'écran.`, (c) => c.cur.selected === A.id);
  add(s8, 'interception', `Sans nom, l'action va à la joueuse sélectionnée : interception de ${n(A)}.`, ev('INTERCEPTION', A.id));

  // ───────── 9 · Lancers francs
  const s9 = '9 · Lancers francs';
  add(s9, `lancer franc ${n(F)}`, `La série de lancers francs de ${n(F)} s'ouvre : regardez le panneau LF 1, LF 2, LF 3.`, (c) => c.cur.selected === F.id && saysRe(/^Lancers francs/)(c));
  add(s9, 'premier réussi', 'Le premier lancer est coché réussi.', (c) => c.cur.ftFilled === 1);
  add(s9, 'deuxième raté', 'Le deuxième est coché raté.', (c) => c.cur.ftFilled === 2);
  add(s9, 'terminé', `Enregistré : LANCERS FRANCS (1/2) pour ${n(F)}, +1 point.`, (c) => added(c) && /LANCERS FRANCS \(1\/2\)/.test(lastEv(c)?.actionType ?? ''), { alts: ['fin de série'] });
  add(s9, `${n(G)} un sur trois`, 'Tout en une phrase : 1 réussi sur 3.', (c) => added(c) && /LANCERS FRANCS \(1\/3\)/.test(lastEv(c)?.actionType ?? ''), { alts: [`lancers francs ${n(G)} un sur trois`] });
  add(s9, `lancers francs ${n(D)} deux sur deux`, 'Autre forme : 2 sur 2.', (c) => added(c) && /LANCERS FRANCS \(2\/2\)/.test(lastEv(c)?.actionType ?? ''));

  // ───────── 10 · Score adverse
  const s10 = '10 · Score adverse';
  add(s10, 'adversaire deux points', "+2 pour l'équipe adverse.", (c) => c.cur.scoreAway === c.base.scoreAway + 2, { alts: ['équipe adverse deux points'] });
  add(s10, 'adversaire trois points', '+3 pour elle.', (c) => c.cur.scoreAway === c.base.scoreAway + 3);
  add(s10, 'adversaire moins un', 'Correction : -1.', (c) => c.cur.scoreAway === c.base.scoreAway - 1);

  // ───────── 11 · Annuler une erreur
  const s11 = '11 · Annuler';
  add(s11, 'annule la dernière commande', 'La dernière action est supprimée, immédiatement (les changements ne sont pas concernés).', (c) => c.cur.events.length < c.base.events.length, { alts: ['annule', 'supprime la dernière action'] });
  add(s11, `annule dernière action ${n(A)}`, `La dernière action de ${n(A)} est supprimée.`, (c) => c.cur.events.length < c.base.events.length);

  // ───────── 12 · Questions (réponse écrite dans le bandeau vocal)
  const s12 = '12 · Questions';
  add(s12, 'score', "Le score s'écrit dans le bandeau vocal (en DIRECT l'appli ne parle pas).", saysRe(/^Nous \d+, eux \d+/));
  add(s12, 'qui est sur le terrain', 'Les cinq joueuses sur le terrain s\'affichent.', saysRe(/^Sur le terrain/));
  add(s12, `combien de fautes ${n(A)}`, `Les fautes de ${n(A)} s'affichent.`, saysRe(/fautes?$/));
  add(s12, 'fautes équipe', "Fautes d'équipe de la période en cours.", saysRe(/d'équipe$/));

  add('Fin', '', "Vous avez vu toutes les commandes. Aide complète : CONFIGURATION puis « Aide ». Le mode d'emploi PDF les liste toutes.", () => false,
    { intro: "Bravo ! Pour recommencer en vrai : touchez « Quitter le didacticiel », puis préparez votre match. Rien de ce match de démonstration n'a été enregistré ; un match que vous aviez ouvert avant le didacticiel est restauré." });
  return S;
}

export { sameSet };
