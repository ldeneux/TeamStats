// lib/voice/tutorial.ts — match de démonstration et parcours guidé (≈ 50 étapes) de la commande vocale.
// Pur et testable : chaque étape donne la phrase à dire, ce qui doit se passer, et comment le vérifier.

export interface DemoPlayer { id: string; name: string; number: number }
export interface DemoMatch { opponent: string; players: DemoPlayer[] }

const OPPONENTS = ['ASVEL BASKET', 'VILLEURBANNE BASKET', 'LYON FÉMININ BASKET', 'BOURG BASKET', 'RILLIEUX BASKET', 'OULLINS BASKET', 'CALUIRE BASKET', 'VÉNISSIEUX BASKET', 'GIVORS BASKET', 'MEYZIEU BASKET'];
// Prénoms qui se prononcent nettement différemment (pas de paires du type Anna / Anaïs) : le didacticiel ne doit pas se tromper.
const NAMES = ['LÉA', 'MANON', 'CAMILLE', 'JADE', 'ZOÉ', 'EMMA', 'LINA', 'SARAH', 'OCÉANE', 'MAËLLE', 'CLARA', 'NORA', 'LOUISE', 'EVA', 'LOLA', 'JULIE', 'ROMANE', 'LUCIE', 'MARGAUX', 'ÉLODIE', 'PAULINE', 'MATHILDE', 'ALICE', 'FLORA'];

const shuffle = <T,>(a: T[], rnd: () => number): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

/** SATHONAY contre une équipe au hasard, 10 joueuses avec prénom et numéro au hasard (numéros tous différents). */
export function makeDemo(rnd: () => number = Math.random): DemoMatch {
  const names = shuffle(NAMES, rnd).slice(0, 10);
  const numbers = shuffle(Array.from({ length: 20 }, (_, i) => i + 1), rnd).slice(0, 10);
  return {
    opponent: OPPONENTS[Math.floor(rnd() * OPPONENTS.length)],
    players: names.map((name, i) => ({ id: `demo-${i + 1}`, name, number: numbers[i] })).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
  };
}

/** Photo de l'écran à un instant : sert à vérifier qu'une commande a eu son effet. */
export interface TutSnap {
  events: Array<{ actionType: string; playerId: string }>;   // le plus récent en premier
  scoreHome: number;
  scoreAway: number;
  clockRunning: boolean;
  onCourt: string[];
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
  /** Phrase à dire (peut dépendre de l'état courant). null : étape manuelle. */
  say: string | ((c: TutCheck) => string);
  /** Ce qui se passe, en une phrase. */
  why: string;
  /** Texte d'introduction (étape manuelle ou explication). */
  intro?: string;
  check: (c: TutCheck) => boolean;
}

const lastEv = (c: TutCheck) => c.cur.events.find((e) => !e.actionType.startsWith('REMPLACEMENT'));
const added = (c: TutCheck) => c.cur.events.length > c.base.events.length;
const ev = (act: string, pid: string) => (c: TutCheck) => added(c) && lastEv(c)?.actionType === act && lastEv(c)?.playerId === pid;
const saysRe = (re: RegExp) => (c: TutCheck) => !!c.last && re.test(c.last.say);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function buildTutorial(players: DemoPlayer[], court: string[]): TutStep[] {
  const cap = (n: string) => n.charAt(0) + n.slice(1).toLowerCase();
  const by = (id: string) => players.find((p) => p.id === id) as DemoPlayer;
  const bench = players.filter((p) => !court.includes(p.id)).map((p) => p.id);
  const [A, B, C, D, E] = court.map(by), [F, G] = bench.slice(0, 2).map(by);
  const n = (p: DemoPlayer) => cap(p.name);
  const S: TutStep[] = [];
  const add = (section: string, say: TutStep['say'], why: string, check: TutStep['check'], intro?: string) => S.push({ section, say, why, check, intro });

  add('Pour commencer', '', "Vous gardez la main : la voix ne s'active que quand vous le décidez.", (c) => c.cur.voiceEnabled,
    "Mettez votre casque, puis touchez le bouton « COMMANDE VOCALE : COUPÉE » en haut de l'écran : il devient vert (ACTIVE). Autorisez le micro si le navigateur le demande.");

  add('Chronomètre', 'démarrer le match', 'Le chronomètre du match tourne.', (c) => c.cur.clockRunning && !c.base.clockRunning);
  add('Chronomètre', 'arrêt chrono', 'Le chronomètre s\'arrête (temps mort, faute…).', (c) => !c.cur.clockRunning && c.base.clockRunning);
  add('Chronomètre', 'reprise du jeu', 'Le chronomètre repart.', (c) => c.cur.clockRunning && !c.base.clockRunning);

  add('Tirs', `${n(A)} deux points`, `Tir à 2 points réussi de ${n(A)} : +2 au score.`, ev('TIR 2PTS RÉUSSI', A.id));
  add('Tirs', `trois points pour ${n(B)}`, `Tir à 3 points réussi de ${n(B)} : +3. L'ordre des mots est libre.`, ev('TIR 3PTS RÉUSSI', B.id));
  add('Tirs', `raté à deux points pour ${n(C)}`, `Tir à 2 points manqué de ${n(C)} : 0 point, la tentative est comptée.`, ev('TIR 2PTS Manqué', C.id));
  add('Tirs', `tir à trois points manqué ${n(D)}`, `Tir à 3 points manqué de ${n(D)}.`, ev('TIR 3PTS Manqué', D.id));
  add('Tirs', `deux points la ${E.number}`, `Vous pouvez désigner une joueuse par son numéro : ici la ${E.number}, c'est ${n(E)}.`, ev('TIR 2PTS RÉUSSI', E.id));

  add('Autres actions', `interception ${n(A)}`, `Interception de ${n(A)}.`, ev('INTERCEPTION', A.id));
  add('Autres actions', `rebond offensif ${n(B)}`, `Rebond offensif de ${n(B)}.`, ev('REBOND OFFENSIF', B.id));
  add('Autres actions', `rebond défensif ${n(C)}`, `Rebond défensif de ${n(C)}.`, ev('REBOND DÉFENSIF', C.id));
  add('Autres actions', `rebond ${n(D)}`, "Sans précision, l'appli demande « offensif ou défensif ? ».", saysRe(/offensif ou défensif/));
  add('Autres actions', 'offensif', `Vous répondez : le rebond offensif de ${n(D)} est enregistré.`, ev('REBOND OFFENSIF', D.id));
  add('Autres actions', 'deux points', "Sans joueuse, l'appli pose une question : « Quelle joueuse ? ».", saysRe(/Quelle joueuse/));
  add('Autres actions', 'abandon', 'Pour abandonner une question (ou toute attente), dites « abandon » : rien n\'est enregistré.', saysRe(/^Abandon/));
  add('Autres actions', `passe décisive ${n(E)}`, `Passe décisive de ${n(E)}.`, ev('PASSE DÉCISIVE', E.id));
  add('Autres actions', `perte de balle de ${n(A)}`, `Perte de balle de ${n(A)}.`, ev('PERTE DE BALLE', A.id));
  add('Autres actions', `balle perdue ${n(B)}`, 'Autre façon de dire la même chose.', ev('PERTE DE BALLE', B.id));
  add('Autres actions', `contre de ${n(C)}`, `${n(C)} contre un tir adverse.`, ev('CONTRE', C.id));
  add('Autres actions', `${n(D)} contrée`, `${n(D)} voit son tir contré (contre subi).`, ev('CONTRE SUBI', D.id));

  add('Fautes', `faute de ${n(A)}`, `Faute personnelle de ${n(A)} (« faute de » = qui la commet).`, ev('FAUTE PERSONNELLE', A.id));
  add('Fautes', `faute sur ${n(B)}`, `Faute subie par ${n(B)} (« faute sur » = qui la subit).`, ev('FAUTE SUBIE', B.id));
  add('Fautes', `faute technique ${n(C)}`, `Faute technique de ${n(C)}.`, ev('FAUTE TECHNIQUE', C.id));
  add('Fautes', `faute antisportive ${n(D)}`, `Faute antisportive de ${n(D)}.`, ev('FAUTE ANTISPORTIVE', D.id));

  add('Sélection', `sélectionne ${n(A)}`, `${n(A)} est sélectionnée à l'écran, comme si vous la touchiez.`, (c) => c.cur.selected === A.id);
  add('Sélection', 'interception', `Sans nom, l'action va à la joueuse sélectionnée : interception de ${n(A)}.`, ev('INTERCEPTION', A.id));

  add('Lancers francs', `lancer franc ${n(B)}`, `La série de lancers francs de ${n(B)} s'ouvre : regardez le panneau LF 1, LF 2, LF 3.`, (c) => c.cur.selected === B.id && saysRe(/^Lancers francs/)(c));
  add('Lancers francs', 'premier réussi', 'Le premier lancer est coché réussi.', (c) => c.cur.ftFilled === 1);
  add('Lancers francs', 'deuxième raté', 'Le deuxième est coché raté.', (c) => c.cur.ftFilled === 2);
  add('Lancers francs', 'terminé', `Enregistré : LANCERS FRANCS (1/2) pour ${n(B)}, +1 point.`, (c) => added(c) && /LANCERS FRANCS \(1\/2\)/.test(lastEv(c)?.actionType ?? ''));
  add('Lancers francs', `${n(C)} un sur trois`, 'Tout en une phrase : 1 réussi sur 3.', (c) => added(c) && /LANCERS FRANCS \(1\/3\)/.test(lastEv(c)?.actionType ?? ''));
  add('Lancers francs', `lancers francs ${n(D)} deux sur deux`, 'Autre forme : 2 sur 2.', (c) => added(c) && /LANCERS FRANCS \(2\/2\)/.test(lastEv(c)?.actionType ?? ''));

  add('Changements', 'afficher changement', 'La fenêtre de changement s\'affiche à l\'écran.', (c) => c.cur.subPanelOpen);
  add('Changements', 'fermer', 'La fenêtre se ferme.', (c) => !c.cur.subPanelOpen);
  add('Changements', `remplacement ${n(A)} par ${n(F)}`, `${n(F)} entre, ${n(A)} sort : le terrain est mis à jour tout de suite (pas de « oui » à dire ; une erreur se corrige par un nouveau changement).`, (c) => c.cur.onCourt.includes(F.id) && !c.cur.onCourt.includes(A.id));
  add('Changements', `sortie de ${n(B)} entrée de ${n(G)}`, `Deuxième façon de dire un changement (plusieurs joueuses possibles) : ${n(G)} entre, ${n(B)} sort.`, (c) => c.cur.onCourt.includes(G.id) && !c.cur.onCourt.includes(B.id));
  add('Changements', (c) => `sur le terrain on a ${[...c.cur.onCourt.filter((id) => id !== C.id).map((id) => n(by(id))), n(A)].join(', ')}`,
    `Troisième façon : citez les cinq qui sont sur le terrain, l'appli déduit qui sort (${n(C)}) et qui entre (${n(A)}).`, (c) => c.cur.onCourt.includes(A.id) && !c.cur.onCourt.includes(C.id));

  add('Annulation', 'annule la dernière commande', 'La dernière action est supprimée, immédiatement (les changements ne sont pas concernés).', (c) => c.cur.events.length < c.base.events.length);
  add('Annulation', `annule dernière action ${n(A)}`, `La dernière action de ${n(A)} est supprimée.`, (c) => c.cur.events.length < c.base.events.length);

  add('Score adverse', 'adversaire deux points', "+2 pour l'équipe adverse.", (c) => c.cur.scoreAway === c.base.scoreAway + 2);
  add('Score adverse', 'adversaire trois points', '+3 pour elle.', (c) => c.cur.scoreAway === c.base.scoreAway + 3);
  add('Score adverse', 'adversaire moins un', 'Correction : -1.', (c) => c.cur.scoreAway === c.base.scoreAway - 1);

  add('Questions', 'score', "L'appli annonce le score à voix haute.", saysRe(/^Nous \d+, eux \d+/));
  add('Questions', 'qui est sur le terrain', "L'appli cite les cinq joueuses sur le terrain.", saysRe(/^Sur le terrain/));
  add('Questions', `combien de fautes ${n(A)}`, `L'appli donne les fautes de ${n(A)}.`, saysRe(/fautes?$/));
  add('Questions', 'fautes équipe', "Fautes d'équipe de la période en cours.", saysRe(/d'équipe$/));

  add('Fin', '', 'Vous connaissez toutes les commandes. Aide complète : bouton « Aide » du bandeau vocal.', () => false,
    'Bravo ! Pour recommencer en vrai : touchez « Quitter le didacticiel », puis préparez votre match. Rien de ce match de démonstration n\'a été enregistré.');
  return S;
}

export { sameSet };
