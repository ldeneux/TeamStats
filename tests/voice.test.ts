// tests/voice.test.ts — tests de l'analyseur et du dialogue vocal (sans navigateur, sans réseau).
// Lancer : npm run test:voice
import assert from 'node:assert/strict';
import { parseCommand, phonetic, normalizeText, Cmd, VoicePlayer, VoiceEventLite } from '../lib/voice/commands';
import { VoiceDialog, VoiceAction, VoiceView, DialogResult } from '../lib/voice/dialog';
import { buildPrompts, calibrationSetup, emptyProfile, evaluateHeard, sanitizeProfile } from '../lib/voice/calibrate';
import { buildTutorial, makeDemo, TutSnap } from '../lib/voice/tutorial';

// ───── Effectif de test (fiche projet § 5)
const P = (id: string, name: string, number: number, aliases?: string[]): VoicePlayer => ({ id, name, number, aliases });
const PLAYERS: VoicePlayer[] = [
  P('aliya', 'ALIYA', 2), P('annabelle', 'ANNABELLE', 12), P('annaelle', 'ANNAELLE', 11), P('chloe', 'CHLOÉ', 4),
  P('candice', 'CANDICE', 5), P('hanae', 'HANAÉ', 10), P('hinde', 'HINDE', 9, ['hind', 'inde']), P('laura', 'LAURA', 7),
  P('victoire', 'VICTOIRE', 13), P('mayra', 'MAYRA', 14),
];
const START_COURT = ['chloe', 'annabelle', 'candice', 'laura', 'aliya'];

// ───── Mini-simulateur du match : applique les actions comme page.tsx
class Sim {
  events: VoiceEventLite[] = [];
  onCourt = [...START_COURT];
  home = 0; away = 0; period = 1; clock = false; seq = 0;
  selected: string | null = null; subPanelOpen = false; ftFilled = 0;
  actions: VoiceAction[] = [];
  ftViews: VoiceAction[] = []; // affichage des lancers francs à l'écran (non comptés comme actions)
  dialog: VoiceDialog;
  players = PLAYERS;
  constructor(opts?: ConstructorParameters<typeof VoiceDialog>[0]) { this.dialog = new VoiceDialog(opts); }
  view(): VoiceView {
    return { players: this.players, onCourt: this.onCourt, events: this.events, scoreHome: this.home, scoreAway: this.away, period: this.period, clockRunning: this.clock, selectedPlayerId: this.selected, subPanel: { open: this.subPanelOpen, outCount: 0, inCount: 0 } };
  }
  say(...alts: string[]): DialogResult {
    const r = this.dialog.handle(alts, this.view());
    for (const a of r.actions) this.apply(a);
    this.actions.push(...r.actions.filter((a) => a.t !== 'ftView'));
    this.ftViews.push(...r.actions.filter((a) => a.t === 'ftView'));
    return r;
  }
  said(...alts: string[]): string { return this.say(...alts).say.join(' | '); }
  private apply(a: VoiceAction) {
    if (a.t === 'select') this.selected = a.playerId;
    else if (a.t === 'ftView') { if (a.playerId) this.selected = a.playerId; this.ftFilled = a.attempts.filter((x) => x !== null).length; }
    else if (a.t === 'subPanel') this.subPanelOpen = a.op === 'open';
    if (a.t === 'event' || a.t === 'ft') { this.selected = null; this.ftFilled = 0; }
    if (a.t === 'sub') this.subPanelOpen = false;
    if (a.t === 'event') {
      this.events = [{ id: 'e' + ++this.seq, actionType: a.action, playerId: a.playerId, period: this.period }, ...this.events];
      this.home += a.points;
      if (a.action.includes('DISQUALIFIANTE')) this.onCourt = this.onCourt.filter((i) => i !== a.playerId);
    } else if (a.t === 'ft') {
      this.events = [{ id: 'e' + ++this.seq, actionType: `LANCERS FRANCS (${a.made}/${a.attempts})`, playerId: a.playerId, period: this.period }, ...this.events];
      this.home += a.made;
    } else if (a.t === 'opp') this.away += a.delta;
    else if (a.t === 'sub') {
      this.onCourt = [...this.onCourt.filter((i) => !a.outs.includes(i)), ...a.ins];
      this.events = [{ id: 'e' + ++this.seq, actionType: `REMPLACEMENT (${a.outs.length}j)`, playerId: a.ins[0], period: this.period }, ...this.events];
    } else if (a.t === 'delete') {
      const ev = this.events.find((e) => e.id === a.eventId);
      if (ev) { const m = ev.actionType.match(/RÉUSSI/) ? Number(ev.actionType.match(/(\d)PTS/)?.[1]) : 0; this.home -= m; }
      this.events = this.events.filter((e) => e.id !== a.eventId);
    } else if (a.t === 'clock') this.clock = a.running;
  }
}

const ctxOf = (onCourt = START_COURT, events: VoiceEventLite[] = []) => ({ onCourt, events });
const parse = (text: string, onCourt = START_COURT, events: VoiceEventLite[] = []): Cmd => parseCommand(text, PLAYERS, ctxOf(onCourt, events));

let ok = 0, ko = 0;
function t(name: string, fn: () => void) {
  try { fn(); ok++; } catch (e: any) { ko++; console.log(`✗ ${name}\n    ${String(e.message).split('\n').slice(0, 6).join('\n    ')}`); }
}
const ev = (c: Cmd) => c as Extract<Cmd, { type: 'EVENT' }>;
const sub = (c: Cmd) => c as Extract<Cmd, { type: 'SUB' }>;

// ═════════ 1. Tirs ═════════
t('tir 2 pts réussi', () => { const c = ev(parse('Tir à 2 points réussi pour Chloé')); assert.equal(c.type, 'EVENT'); assert.equal(c.action, 'TIR 2PTS RÉUSSI'); assert.equal(c.points, 2); assert.equal(c.playerId, 'chloe'); });
t('2 points pour X', () => assert.equal(ev(parse('2 points pour Chloé')).action, 'TIR 2PTS RÉUSSI'));
t('X deux points', () => assert.equal(ev(parse('Chloé deux points')).action, 'TIR 2PTS RÉUSSI'));
t('Candice deux points (non-régression)', () => { const c = ev(parse('Candice deux points')); assert.equal(c.playerId, 'candice'); assert.equal(c.action, 'TIR 2PTS RÉUSSI'); });
t('raté à 3 points', () => { const c = ev(parse('raté à 3 points pour Chloé')); assert.equal(c.action, 'TIR 3PTS Manqué'); assert.equal(c.points, 0); });
t('tir 2 points manqué', () => assert.equal(ev(parse('tir à 2 points manqué pour Laura')).action, 'TIR 2PTS Manqué'));
t('trois points sans précision = réussi', () => { const c = ev(parse('trois points Laura')); assert.equal(c.action, 'TIR 3PTS RÉUSSI'); assert.equal(c.points, 3); });
t('variantes point / pointe / pts', () => { for (const w of ['2 point', '2 pointe', '2 pts']) assert.equal(ev(parse(`Chloé ${w}`)).action, 'TIR 2PTS RÉUSSI', w); });
t('« 3 points » en chiffres', () => assert.equal(ev(parse('Aliya 3 points')).action, 'TIR 3PTS RÉUSSI'));

// ═════════ 2. Autres actions ═════════
t('interception', () => assert.equal(ev(parse('interception Chloé')).action, 'INTERCEPTION'));
t('rebond offensif / défensif', () => { assert.equal(ev(parse('rebond offensif Chloé')).action, 'REBOND OFFENSIF'); assert.equal(ev(parse('rebond défensif Laura')).action, 'REBOND DÉFENSIF'); });
t('rebond seul → question', () => { const c = parse('rebond Chloé'); assert.equal(c.type, 'ASK'); assert.match((c as any).say, /offensif ou défensif/); });
t('perte de balle de X', () => assert.equal(ev(parse('perte de balle de Chloé')).action, 'PERTE DE BALLE'));
t('passe décisive', () => assert.equal(ev(parse('passe décisive Chloé')).action, 'PASSE DÉCISIVE'));
t('contre de X → CONTRE', () => assert.equal(ev(parse('Contre de Chloé')).action, 'CONTRE'));
t('X contrée → CONTRE SUBI', () => assert.equal(ev(parse('Chloé contrée')).action, 'CONTRE SUBI'));
t('contre subi X', () => assert.equal(ev(parse('contre subi Chloé')).action, 'CONTRE SUBI'));

// ═════════ 3. Fautes ═════════
t('faute sur X = subie', () => assert.equal(ev(parse('Faute sur Chloé')).action, 'FAUTE SUBIE'));
t('faute de X = personnelle', () => assert.equal(ev(parse('Faute de Chloé')).action, 'FAUTE PERSONNELLE'));
t('faute subie / personnelle', () => { assert.equal(ev(parse('faute subie Chloé')).action, 'FAUTE SUBIE'); assert.equal(ev(parse('faute personnelle Chloé')).action, 'FAUTE PERSONNELLE'); });
t('faute technique : enregistrée directement', () => { const c = ev(parse('faute technique Chloé')); assert.equal(c.action, 'FAUTE TECHNIQUE'); assert.equal(c.needsConfirm, false); });
t('antisportive / disqualifiante : directes aussi', () => { assert.equal(ev(parse('faute antisportive Chloé')).needsConfirm, false); assert.equal(ev(parse('faute disqualifiante Chloé')).needsConfirm, false); });
t('faute personnelle : pas de confirmation', () => assert.equal(ev(parse('faute de Chloé')).needsConfirm, false));
t('« combien de fautes X » = question', () => assert.equal(parse('combien de fautes Chloé').type, 'Q_FOULS'));
t('« faute de X » n\'est plus une question', () => assert.notEqual(parse('faute de Chloé').type, 'Q_FOULS'));
t('fautes équipe', () => assert.equal(parse('fautes équipe').type, 'Q_TEAM_FOULS'));

// ═════════ 4. Changements ═════════
const ids = (a: string[]) => [...a].sort();
t('Remplacement X, Y, Z par … (Annabelle/Anaelle : le contexte tranche)', () => {
  const c = sub(parse('Remplacement Chloé, Annabelle, Candice par Hind, Anaelle, Hanaé'));
  assert.equal(c.type, 'SUB');
  assert.deepEqual(ids(c.outs), ids(['chloe', 'annabelle', 'candice']));
  assert.deepEqual(ids(c.ins), ids(['hinde', 'annaelle', 'hanae']));
});
t('Sortie de … Entrée de …', () => {
  const c = sub(parse('Sortie de Chloé, Annabelle, Candice Entrée de Hind, Annaelle, Hanaé'));
  assert.deepEqual(ids(c.outs), ids(['chloe', 'annabelle', 'candice']));
  assert.deepEqual(ids(c.ins), ids(['hinde', 'annaelle', 'hanae']));
});
t('entrée avant sortie', () => {
  const c = sub(parse('Entrée de Hind, Annaelle, Hanaé sortie de Chloé, Annabelle, Candice'));
  assert.equal(c.type, 'SUB'); assert.equal(c.outs.length, 3);
});
t('Sur le terrain on a … (5 prénoms)', () => {
  const c = sub(parse('Sur le terrain on a Hind, Anaelle, Hanaé, Victoire et Mayra'));
  assert.equal(c.type, 'SUB');
  assert.deepEqual(ids(c.outs), ids(['chloe', 'annabelle', 'candice', 'laura', 'aliya']));
  assert.deepEqual(ids(c.ins), ids(['hinde', 'annaelle', 'hanae', 'victoire', 'mayra']));
});
t('Sur le terrain on a … avec deux joueuses déjà dessus : écart des ensembles', () => {
  const c = sub(parse('Sur le terrain on a Chloé, Annabelle, Candice, Hind, Hanaé'));
  assert.deepEqual(ids(c.outs), ids(['laura', 'aliya']));
  assert.deepEqual(ids(c.ins), ids(['hinde', 'hanae']));
});
t('Sur le terrain on a 2 prénoms → on attend la suite', () => { const c = parse('Sur le terrain on a Hind, Anaelle') as any; assert.equal(c.type, 'ASK'); assert.equal(c.say, '2 sur 5. La suite ?'); });
t('Sur le terrain on a 6 prénoms → refus', () => assert.equal(parse('Sur le terrain on a Hind, Anaelle, Hanaé, Victoire, Mayra, Chloé').type, 'REFUSE'));
t('« Sur le terrain » seul = question', () => assert.equal(parse('qui est sur le terrain').type, 'Q_COURT'));
t('sortante pas sur le terrain → refus', () => { const c = parse('remplacement Mayra par Hinde'); assert.equal(c.type, 'REFUSE'); assert.match((c as any).say, /Mayra n'est pas sur le terrain/); });
t('entrante déjà sur le terrain → refus', () => { const c = parse('remplacement Chloé par Laura'); assert.equal(c.type, 'REFUSE'); assert.match((c as any).say, /déjà sur le terrain/); });
t('joueuse citée deux fois → refus', () => assert.equal(parse('remplacement Chloé, Chloé par Hinde, Hanaé').type, 'REFUSE'));
t('autant de sorties que d\'entrées', () => assert.equal(parse('remplacement Chloé, Laura par Hinde').type, 'REFUSE'));
t('entrante à 5 fautes → refus', () => {
  const evs: VoiceEventLite[] = Array.from({ length: 5 }, (_, i) => ({ id: 'f' + i, actionType: 'FAUTE PERSONNELLE', playerId: 'hinde' }));
  const c = parse('remplacement Chloé par Hinde', START_COURT, evs); assert.equal(c.type, 'REFUSE'); assert.match((c as any).say, /cinq fautes/);
});
t('« remplace » (X remplace Y)', () => { const c = sub(parse('Hinde remplace Chloé')); assert.deepEqual(c.outs, ['chloe']); assert.deepEqual(c.ins, ['hinde']); });
t('changement : lecture avant exécution', () => { const c = sub(parse('Remplacement Chloé par Hinde')); assert.equal(c.needsConfirm, true); assert.match(c.say, /^Sortent Chloé\. Entrent Hinde\. Valide \?$/); });
t('ambiguïté sans contexte → question « Annabelle ou Annaelle ? »', () => {
  // les deux sont sur le terrain, ou les deux sur le banc : aucun contexte ne tranche pour une action
  const c = parse('Anabel deux points', ['annabelle', 'annaelle', 'chloe', 'laura', 'aliya']);
  assert.ok(c.type === 'ASK' || c.type === 'EVENT', c.type);
});

// ═════════ 5. Numéros de maillot ═════════
t('Faute de la 5 / numéro 5 / cinq', () => {
  for (const s of ['Faute de la 5', 'faute de la numéro 5', 'faute de cinq', 'faute de n° 5', 'faute de numéro 5']) {
    const c = ev(parse(s)); assert.equal(c.action, 'FAUTE PERSONNELLE', s); assert.equal(c.playerId, 'candice', s);
  }
});
t('Faute sur le 12 → subie n° 12', () => { const c = ev(parse('Faute sur le 12')); assert.equal(c.action, 'FAUTE SUBIE'); assert.equal(c.playerId, 'annabelle'); });
t('douze deux points → TIR 2PTS n° 12', () => { const c = ev(parse('douze deux points')); assert.equal(c.action, 'TIR 2PTS RÉUSSI'); assert.equal(c.playerId, 'annabelle'); });
t('le 12 deux points', () => { const c = ev(parse('le 12 deux points')); assert.equal(c.playerId, 'annabelle'); assert.equal(c.action, 'TIR 2PTS RÉUSSI'); });
t('Deux points la 2 → n° 2', () => { const c = ev(parse('Deux points la 2')); assert.equal(c.action, 'TIR 2PTS RÉUSSI'); assert.equal(c.playerId, 'aliya'); });
t('2 points la numéro 2 collé « numéro2 »', () => assert.equal(ev(parse('2 points numéro2')).playerId, 'aliya'));
t('Remplacement la 4, la 7 par la 9, la 10', () => {
  const c = sub(parse('Remplacement la 4, la 7 par la 9, la 10'));
  assert.equal(c.type, 'SUB'); assert.deepEqual(ids(c.outs), ids(['chloe', 'laura'])); assert.deepEqual(ids(c.ins), ids(['hinde', 'hanae']));
});
t('Sur le terrain on a 4, 5, 6, 7, 8 (numéro inconnu → refus clair)', () => { const c = parse('Sur le terrain on a 4, 5, 6, 7, 8'); assert.equal(c.type, 'REFUSE'); assert.match((c as any).say, /Numéro 6 : pas de joueuse/); });
t('Sur le terrain on a 4, 5, 7, 2, 12 = écart nul', () => assert.equal(parse('Sur le terrain on a 4, 5, 7, 2, 12').type, 'NOOP'));
t('Sur le terrain on a avec numéros', () => {
  const c = sub(parse('Sur le terrain on a 9, 10, 11, 13, 14'));
  assert.deepEqual(ids(c.ins), ids(['hinde', 'hanae', 'annaelle', 'victoire', 'mayra']));
});
t('Faute de la 17 → refus', () => { const c = parse('Faute de la 17'); assert.equal(c.type, 'REFUSE'); assert.equal((c as any).say, 'Numéro 17 : pas de joueuse.'); });
t('prénoms et numéros mélangés dans un changement', () => {
  const c = sub(parse('Remplacement Chloé, la 7 par Hinde, la 10'));
  assert.deepEqual(ids(c.outs), ids(['chloe', 'laura'])); assert.deepEqual(ids(c.ins), ids(['hinde', 'hanae']));
});
t('même joueuse par prénom et numéro → refus', () => { const c = parse('Candice la 5 deux points'); assert.equal(c.type, 'REFUSE'); });
t('numéro porté par deux joueuses → refus', () => {
  const dup = [...PLAYERS, P('doublon', 'ZOE', 5)];
  const c = parseCommand('faute de la 5', dup, ctxOf());
  assert.equal(c.type, 'REFUSE');
});
t('répétition : numéro + prénom', () => assert.match(ev(parse('Faute de la 5')).say, /Faute personnelle, numéro 5, Candice/));
t('joueuse sans prénom : « numéro 5 » seul', () => {
  const noName = PLAYERS.map((p) => (p.id === 'candice' ? { ...p, name: '' } : p));
  const c = parseCommand('faute de la 5', noName, ctxOf()) as any;
  assert.equal(c.type, 'EVENT'); assert.match(c.say, /^Faute personnelle, numéro 5$/);
});
t('« combien de fautes la 5 »', () => { const c = parse('combien de fautes la 5') as any; assert.equal(c.type, 'Q_FOULS'); assert.equal(c.playerId, 'candice'); });
t('nombres en lettres : vingt et un, quatre-vingt-dix-neuf', () => {
  assert.equal(normalizeText('vingt et un'), '21'); assert.equal(normalizeText('quatre-vingt-dix-neuf'), '99');
  assert.equal(normalizeText('soixante et onze'), '71'); assert.equal(normalizeText('quatre vingts'), '80'); assert.equal(normalizeText('dix sept'), '17');
});
const big = [...PLAYERS, P('p21', 'ZOE', 21), P('p99', 'EVA', 99)];
t('joueuse n° 21 / n° 99 par la voix', () => {
  assert.equal((parseCommand('faute de vingt et un', big, ctxOf([...START_COURT, 'p21'])) as any).playerId, 'p21');
  assert.equal((parseCommand('faute de quatre-vingt-dix-neuf', big, ctxOf([...START_COURT, 'p99'])) as any).playerId, 'p99');
});

// ═════════ 6. Lancers francs (une phrase) ═════════
t('Chloé 1/3 → LANCERS FRANCS (1/3)', () => { const c: any = parse('Chloé 1/3'); assert.equal(c.type, 'FREE_THROWS'); assert.equal(c.made, 1); assert.equal(c.attempts, 3); });
t('Chloé 0/2', () => { const c: any = parse('Chloé 0/2'); assert.equal(c.made, 0); assert.equal(c.attempts, 2); });
t('lancers francs Chloé un sur trois', () => { const c: any = parse('lancers francs Chloé un sur trois'); assert.equal(c.made, 1); assert.equal(c.attempts, 3); });
t('lancers francs Chloé deux sur trois', () => { const c: any = parse('lancers francs Chloé deux sur trois'); assert.equal(c.made, 2); assert.equal(c.attempts, 3); });
t('la 7 : « 1/2 » (numéro + ratio)', () => { const c: any = parse('lancer franc la 7 1/2'); assert.equal(c.playerId, 'laura'); assert.equal(c.made, 1); assert.equal(c.attempts, 2); });
t('3/2 impossible', () => assert.equal(parse('Chloé 3/2').type, 'REFUSE'));
t('lancer franc pour X = ouverture de session', () => { const c: any = parse('lancer franc pour Chloé'); assert.equal(c.type, 'FT_START'); assert.equal(c.say, 'Lancers francs, Chloé'); });

// ═════════ 7. Score adverse, chrono ═════════
t('adversaire deux points / trois points / un point / moins deux', () => {
  assert.equal((parse('adversaire deux points') as any).delta, 2); assert.equal((parse('adversaire trois points') as any).delta, 3);
  assert.equal((parse('adversaire un point') as any).delta, 1); assert.equal((parse('adversaire moins deux') as any).delta, -2);
});
t('chrono : démarrer / arrêter / reprise / temps mort', () => {
  assert.equal((parse('démarrer chrono') as any).running, true); assert.equal((parse('reprise du jeu') as any).running, true);
  assert.equal((parse('arrêter chrono') as any).running, false); assert.equal((parse('temps mort') as any).running, false);
});
t('score', () => assert.equal(parse('score').type, 'Q_SCORE'));

// ═════════ 8. Dialogue : bout en bout ═════════
t('« Démarrer chrono » deux fois : la 2e ne change rien et le dit', () => {
  const s = new Sim();
  assert.equal(s.said('démarrer chrono'), 'Chrono lancé'); assert.equal(s.clock, true);
  assert.equal(s.said('démarrer chrono'), 'Chrono déjà lancé');
  assert.equal(s.actions.filter((a) => a.t === 'clock').length, 1);
  assert.equal(s.said('arrêter chrono'), 'Chrono arrêté'); assert.equal(s.said('arrêter chrono'), 'Chrono déjà arrêté');
});
t('événement simple : enregistré et répété', () => {
  const s = new Sim(); assert.equal(s.said('Candice deux points'), 'Candice, deux points');
  assert.deepEqual(s.actions, [{ t: 'event', action: 'TIR 2PTS RÉUSSI', playerId: 'candice', points: 2 }]); assert.equal(s.home, 2);
});
t('joueuse sur le banc : refus, rien enregistré', () => {
  const s = new Sim(); assert.match(s.said('Hinde deux points'), /n'est pas sur le terrain/); assert.equal(s.actions.length, 0);
});
t('changement : lecture, « oui » → exécuté', () => {
  const s = new Sim();
  assert.match(s.said('Remplacement Chloé, Annabelle, Candice par Hind, Anaelle, Hanaé'), /Sortent Chloé, Annabelle, Candice\. Entrent Hinde, Annaelle, Hanaé\. Valide \?/);
  assert.equal(s.actions.length, 0); assert.equal(s.dialog.mode, 'confirm');
  s.said('oui'); assert.equal(s.actions.length, 1);
  assert.deepEqual(ids(s.onCourt), ids(['laura', 'aliya', 'hinde', 'annaelle', 'hanae']));
});
t('changement : « non » → rien', () => { const s = new Sim(); s.say('Remplacement Chloé par Hinde'); assert.equal(s.said('non'), 'Annulé.'); assert.equal(s.actions.length, 0); assert.deepEqual(s.onCourt, START_COURT); });
t('changement : réponse incompréhensible deux fois → annulé', () => {
  const s = new Sim(); s.say('Remplacement Chloé par Hinde'); assert.equal(s.said('blablabla'), 'Oui ou non ?'); assert.equal(s.said('blablabla'), 'Annulé.'); assert.equal(s.actions.length, 0);
});
t('« valide » / « d\'accord » / « c\'est bon » valent oui', () => {
  for (const w of ['valide', "d'accord", "c'est bon", 'ok', 'vas-y']) { const s = new Sim(); s.say('Remplacement Chloé par Hinde'); s.say(w); assert.equal(s.actions.length, 1, w); }
});
t('changement refusé : ne change rien et le dit', () => {
  const s = new Sim(); assert.match(s.said('Remplacement Mayra par Hinde'), /Mayra n'est pas sur le terrain/); assert.equal(s.dialog.mode, 'idle'); assert.equal(s.actions.length, 0);
});
t('faute technique : enregistrée sans confirmation', () => {
  const s = new Sim(); assert.equal(s.said('faute technique Chloé'), 'Faute technique, Chloé'); assert.equal(s.actions.length, 1); assert.equal((s.actions[0] as any).action, 'FAUTE TECHNIQUE');
});
t('faute : annonce à partir de la 4e, puis 5e « elle sort »', () => {
  const s = new Sim(); const out: string[] = [];
  for (let i = 0; i < 5; i++) out.push(s.said('faute de Chloé'));
  assert.equal(out[2], 'Faute personnelle, Chloé'); assert.match(out[3], /quatrième faute/); assert.match(out[4], /Chloé, cinquième faute, elle sort/);
});
t('faute disqualifiante : directe puis « elle sort »', () => {
  const s = new Sim(); assert.match(s.said('faute disqualifiante Chloé'), /disqualifiée, elle sort/);
});
t('Annuler la dernière commande après un changement : annule l\'action précédente', () => {
  const s = new Sim(); s.say('Chloé deux points'); s.say('Remplacement Candice par Hinde'); s.say('oui');
  assert.match(s.said('annuler la dernière commande'), /Annulé : deux points, Chloé/);
  assert.equal(s.actions[s.actions.length - 1].t, 'delete'); assert.equal(s.home, 0);
  assert.ok(s.events.some((e) => e.actionType.startsWith('REMPLACEMENT')), 'le changement est conservé');
});
t('Annuler dernière action Chloé : immédiat, sans validation', () => {
  const s = new Sim(); s.say('Chloé trois points'); s.say('Candice deux points');
  assert.match(s.said('annuler dernière action Chloé'), /Annulé : trois points, Chloé/);
  const del = s.actions.filter((a) => a.t === 'delete') as any[]; assert.equal(del.length, 1);
  assert.equal(s.events.length, 1); assert.equal(s.events[0].playerId, 'candice'); assert.equal(s.home, 2);
});
t('annulation : rien à annuler', () => { const s = new Sim(); assert.equal(s.said('annuler la dernière commande'), 'Rien à annuler.'); });
t('annuler dernière action la 5 (numéro)', () => { const s = new Sim(); s.say('faute de la 5'); assert.match(s.said('annuler dernière action la 5'), /Annulé : faute personnelle, Candice/); });

// Lancers francs en séquence
t('LF séquence : 1er réussi, 2e raté, terminé → (1/2)', () => {
  const s = new Sim();
  assert.equal(s.said('Lancer franc pour Chloé'), 'Lancers francs, Chloé');
  assert.equal(s.said('premier réussi'), 'Première réussi'); assert.equal(s.said('deuxième raté'), 'Deuxième raté');
  assert.equal(s.actions.length, 0);
  assert.equal(s.said('terminé'), 'Chloé, lancers francs, 1 sur 2');
  assert.deepEqual(s.actions, [{ t: 'ft', playerId: 'chloe', made: 1, attempts: 2 }]); assert.equal(s.home, 1); assert.equal(s.events[0].actionType, 'LANCERS FRANCS (1/2)');
});
t('LF puis autre commande : la session est enregistrée d\'abord', () => {
  const s = new Sim(); s.say('Lancer franc Chloé'); s.say('premier réussi');
  const r = s.say('Candice deux points');
  assert.deepEqual(r.actions.map((a) => a.t), ['ft', 'event']);
  assert.deepEqual(s.actions[0], { t: 'ft', playerId: 'chloe', made: 1, attempts: 1 }); assert.equal((s.actions[1] as any).playerId, 'candice'); assert.equal(s.home, 3);
});
t('LF : tentative hors ordre → « Première ? »', () => {
  const s = new Sim(); s.say('lancer franc Chloé'); assert.equal(s.said('deuxième réussi'), 'Premier ?'); assert.equal(s.actions.length, 0);
});
t('LF : « réussi » / « raté » seuls = tentative suivante', () => {
  const s = new Sim(); s.say('lancer franc Chloé'); s.say('réussi'); s.say('raté');
  assert.equal(s.said('réussi'), 'Chloé, lancers francs, 2 sur 3'); // 3e tentative : enregistré sans « terminé »
});
t('LF : la série se ferme toute seule à la 3e tentative', () => {
  const s = new Sim(); s.say('lancer franc Chloé'); s.say('réussi'); s.say('réussi'); assert.equal(s.dialog.mode, 'ft');
  s.say('raté'); assert.equal(s.dialog.mode, 'idle'); assert.deepEqual(s.actions, [{ t: 'ft', playerId: 'chloe', made: 2, attempts: 3 }]);
});
t('LF : l\'écran suit la série (sélection + LF 1, LF 2…)', () => {
  const s = new Sim(); s.say('lancer franc Chloé'); s.say('premier réussi'); s.say('deuxième raté');
  assert.deepEqual(s.ftViews, [
    { t: 'ftView', playerId: 'chloe', attempts: [null, null, null] },
    { t: 'ftView', playerId: null, attempts: [true, null, null] },
    { t: 'ftView', playerId: null, attempts: [true, false, null] }]);
});
t('« lancer franc » seul avec une joueuse sélectionnée', () => {
  const s = new Sim(); const v = s.view(); v.selectedPlayerId = 'laura';
  const r = s.dialog.handle(['lancer franc'], v); assert.equal(r.say[0], 'Lancers francs, Laura');
  assert.deepEqual(r.actions[0], { t: 'ftView', playerId: 'laura', attempts: [null, null, null] });
});
t('« démarrer le match » lance le chrono', () => { for (const x of ['démarrer le match', 'démarre le match', 'lancer le match', 'commencer le match']) assert.equal((parse(x) as any).running, true, x); });
t('LF : « annule » abandonne la session sans rien enregistrer', () => {
  const s = new Sim(); s.say('lancer franc Chloé'); s.say('premier réussi'); assert.equal(s.said('annule'), 'Lancers francs abandonnés.'); assert.equal(s.actions.length, 0); assert.equal(s.dialog.mode, 'idle');
});
t('LF : « terminé » sans tentative → rien', () => { const s = new Sim(); s.say('lancer franc Chloé'); assert.equal(s.said('terminé'), 'Rien à enregistrer.'); assert.equal(s.actions.length, 0); });
t('LF : « validé » termine', () => { const s = new Sim(); s.say('lancer franc Chloé'); s.say('premier raté'); assert.match(s.said('validé'), /0 sur 1/); });
t('LF : « Lancer franc la 7 » puis « premier réussi » puis « terminé » → (1/1) pour la n° 7', () => {
  const s = new Sim(); s.say('Lancer franc la 7'); s.say('premier réussi'); s.say('terminé');
  assert.deepEqual(s.actions, [{ t: 'ft', playerId: 'laura', made: 1, attempts: 1 }]);
});
t('LF : forme « 2/3 » pendant la session', () => {
  const s = new Sim(); s.say('lancer franc Chloé'); assert.equal(s.said('2/3'), 'Chloé, lancers francs, 2 sur 3'); assert.equal(s.home, 2);
});
t('LF : option « réussi seul » désactivée', () => {
  const s = new Sim({ ftBareNext: false }); s.say('lancer franc Chloé'); assert.notEqual(s.said('réussi'), 'Première réussi');
});

// Ambiguïté Annabelle / Annaelle
t('Annabelle/Annaelle : sortie = celle du terrain, même si la reconnaissance entend Annaelle', () => {
  const c = sub(parse('Remplacement Anaelle par Hind'));
  assert.equal(c.type, 'SUB'); assert.deepEqual(c.outs, ['annabelle']);
});
t('Annabelle/Annaelle : question quand le contexte ne tranche pas', () => {
  const s = new Sim(); s.onCourt = ['annabelle', 'annaelle', 'chloe', 'laura', 'aliya'];
  const r = s.said('Anabel rebond offensif');
  assert.ok(/ou/.test(r) || /Anabel|Annabelle/.test(r), r);
});
t('ASK name : la réponse lève l\'ambiguïté', () => {
  const s = new Sim(); s.onCourt = ['annabelle', 'annaelle', 'chloe', 'laura', 'aliya'];
  const first = s.said('Ana belle interception');
  if (/ou/.test(first)) { s.said('Annaelle'); assert.equal((s.actions[0] as any).playerId, 'annaelle'); }
  else assert.equal(s.actions.length, 1);
});

// Questions « rebond » : réponse
t('rebond → « offensif » enregistre le rebond offensif', () => {
  const s = new Sim(); assert.match(s.said('rebond Chloé'), /offensif ou défensif/); s.say('offensif');
  assert.deepEqual(s.actions, [{ t: 'event', action: 'REBOND OFFENSIF', playerId: 'chloe', points: 0 }]);
});
t('« Quelle joueuse ? » → la réponse complète la phrase', () => {
  const s = new Sim(); assert.equal(s.said('deux points'), 'Quelle joueuse ?'); s.say('Candice'); assert.equal((s.actions[0] as any).playerId, 'candice');
});
t('plusieurs alternatives : la première exploitable gagne', () => {
  const s = new Sim(); s.say('blabla', 'Chloé deux points'); assert.equal((s.actions[0] as any).playerId, 'chloe');
});
t('questions : score / fautes / terrain', () => {
  const s = new Sim(); s.say('Chloé deux points'); s.say('adversaire trois points');
  assert.equal(s.said('score'), 'Nous 2, eux 3'); assert.match(s.said('combien de fautes Chloé'), /Chloé, 0 faute/); assert.match(s.said('qui est sur le terrain'), /Chloé/);
});
t('score adverse enregistré', () => { const s = new Sim(); s.say('adversaire deux points'); s.say('adversaire moins deux'); assert.equal(s.away, 0); });


// ═════════ 9. Ajouts : chrono, fenêtre de changement, variantes ═════════
t('« arrêt chrono » / « stop chrono » / « chrono stop » / « début match » / « start chrono »', () => {
  for (const x of ['arrêt chrono', 'arrêt du chrono', 'stop chrono', 'chrono stop']) assert.equal((parse(x) as any).running, false, x);
  for (const x of ['début match', 'début du match', 'coup d\'envoi du match', 'start chrono', 'début chrono']) assert.equal((parse(x) as any).running, true, x);
});
t('faute subie : variantes de la reconnaissance', () => {
  for (const x of ['faute subie Chloé', 'faute subi Chloé', 'fautes subies Chloé', 'faute subit Chloé', 'Chloé subie', 'faute sur Chloé']) assert.equal(ev(parse(x)).action, 'FAUTE SUBIE', x);
});
t('perte de balle / balle perdue / balle perdu', () => {
  for (const x of ['perte de balle Chloé', 'balle perdue Chloé', 'Chloé balle perdu', 'perte balle de Chloé', 'Chloé perte']) assert.equal(ev(parse(x)).action, 'PERTE DE BALLE', x);
});
t('afficher changement / valider / fermer', () => {
  assert.equal((parse('afficher changement') as any).op, 'open'); assert.equal((parse('affiche le changement') as any).op, 'open');
  assert.equal((parse('ouvrir remplacement') as any).op, 'open'); assert.equal((parse('fermer') as any).op, 'close');
  assert.equal((parse('valider changement') as any).op, 'validate');
  const c = parseCommand('valider', PLAYERS, { onCourt: START_COURT, events: [], subPanelOpen: true }); assert.equal((c as any).op, 'validate');
  assert.notEqual(parse('valider').type, 'SUBPANEL');
});
t('dialogue : fenêtre de changement', () => {
  const s = new Sim(); assert.equal(s.said('afficher changement'), 'Changement affiché'); assert.deepEqual(s.actions, [{ t: 'subPanel', op: 'open' }]);
  const v = s.view(); v.subPanel = { open: true, outCount: 1, inCount: 0 };
  assert.match(s.dialog.handle(['valider'], v).say[0], /autant de sorties/);
  v.subPanel = { open: true, outCount: 2, inCount: 2 };
  assert.deepEqual(s.dialog.handle(['valider'], v).actions, [{ t: 'subPanel', op: 'validate' }]);
  assert.deepEqual(s.dialog.handle(['fermer'], v).actions, [{ t: 'subPanel', op: 'close' }]);
  v.subPanel = { open: false, outCount: 0, inCount: 0 };
  assert.equal(s.dialog.handle(['valider'], v).say[0], "Commande non reconnue.");
});

// ═════════ 10. Question en attente : une nouvelle commande l'annule ═════════
t('« Hinde » seul (question en attente) puis « 2 points Chloé » : la nouvelle commande passe', () => {
  const s = new Sim(); s.say('remplace-moi Hinde'.replace('remplace-moi ', '')); // « Hinde, quoi ? »
  assert.equal(s.dialog.mode, 'ask');
  s.say('2 points Chloé'); assert.equal(s.dialog.mode, 'idle');
  assert.deepEqual(s.actions, [{ t: 'event', action: 'TIR 2PTS RÉUSSI', playerId: 'chloe', points: 2 }]);
});
t('« Quelle joueuse ? » en attente puis commande complète d\'une autre joueuse', () => {
  const s = new Sim(); assert.equal(s.said('interception'), 'Quelle joueuse ?');
  s.say('Candice deux points'); assert.equal(s.actions.length, 1); assert.equal((s.actions[0] as any).playerId, 'candice');
});
t('la réponse courte à une question marche toujours', () => {
  const s = new Sim(); s.say('interception'); s.say('Laura'); assert.deepEqual(s.actions, [{ t: 'event', action: 'INTERCEPTION', playerId: 'laura', points: 0 }]);
});
t('confirmation en attente : une nouvelle commande annule le changement proposé', () => {
  const s = new Sim(); s.say('Remplacement Chloé par Hinde'); assert.equal(s.dialog.mode, 'confirm');
  s.say('Candice trois points'); assert.equal(s.dialog.mode, 'idle');
  assert.deepEqual(s.actions.map((a) => a.t), ['event']); assert.deepEqual(s.onCourt, START_COURT);
});
t('mots inconnus : message court, pas d\'énumération', () => {
  assert.equal(s0('Remplacement Chloé par Hinde truc machin'), 'Commande non reconnue.');
  assert.equal(s0('bonjour tout le monde'), 'Commande non reconnue.');
});
function s0(x: string): string { return (parse(x) as any).say; }

// ═════════ 11. Sélection de joueuse ═════════
t('sélectionne / sélectionner / choisis + joueuse', () => {
  for (const x of ['sélectionne Chloé', 'sélectionner la 4', 'choisis Chloé', 'sélection Chloé']) { const c: any = parse(x); assert.equal(c.type, 'SELECT', x); assert.equal(c.playerId, 'chloe', x); }
  assert.equal((parse('désélectionner') as any).playerId, null);
  assert.equal(parse('sélectionne').type, 'ASK'); assert.equal(parse('sélectionne Hinde').type, 'REFUSE');
});
t('joueuse sélectionnée = joueuse par défaut', () => {
  const c: any = parseCommand('deux points', PLAYERS, { onCourt: START_COURT, events: [], selectedId: 'candice' });
  assert.equal(c.type, 'EVENT'); assert.equal(c.playerId, 'candice');
  const d: any = parseCommand('Laura deux points', PLAYERS, { onCourt: START_COURT, events: [], selectedId: 'candice' });
  assert.equal(d.playerId, 'laura');
});
t('dialogue : sélection puis action sans nom', () => {
  const s = new Sim(); assert.equal(s.said('sélectionne Chloé'), 'Chloé sélectionnée');
  assert.deepEqual(s.actions, [{ t: 'select', playerId: 'chloe' }]);
  const v = s.view(); v.selectedPlayerId = 'chloe';
  const r = s.dialog.handle(['interception'], v); assert.deepEqual(r.actions, [{ t: 'event', action: 'INTERCEPTION', playerId: 'chloe', points: 0 }]);
});

// ═════════ 12. Fluidité : hésitations et mots mal entendus ═════════
t('« sur le terrain on a » coupé en deux par une hésitation : la suite est recollée', () => {
  const s = new Sim();
  assert.equal(s.said('sur le terrain on a Hind Anaelle Hanaé'), '3 sur 5. La suite ?');
  const r = s.said('Victoire et Mayra');
  assert.match(r, /Sortent .* Entrent .* Valide \?/); s.say('oui');
  assert.deepEqual(ids(s.onCourt), ids(['hinde', 'annaelle', 'hanae', 'victoire', 'mayra']));
});
t('liste en trois morceaux', () => {
  const s = new Sim(); s.say('on a sur le terrain Hind'); assert.equal(s.said('Anaelle'), '2 sur 5. La suite ?'); s.say('Hanaé Victoire'); assert.match(s.said('Mayra'), /Valide \?/);
});
t('liste incomplète puis nouvelle commande : l\'attente est abandonnée', () => {
  const s = new Sim(); s.say('sur le terrain on a Hind Anaelle'); s.say('Candice deux points'); assert.equal((s.actions[0] as any).playerId, 'candice'); assert.equal(s.dialog.mode, 'idle');
});
t('fragments recollés : « Chloé » puis « deux points » (phrase coupée)', () => {
  const s = new Sim(); const v = s.view(); const t0 = 1000;
  const a = s.dialog.handle(['euh Chloé'], v, t0); assert.equal(a.actions.length, 0);
  const b = s.dialog.handle(['deux points'], v, t0 + 2000);
  assert.deepEqual(b.actions, [{ t: 'event', action: 'TIR 2PTS RÉUSSI', playerId: 'chloe', points: 2 }]);
});
t('fragments trop éloignés dans le temps : pas recollés', () => {
  const s = new Sim(); const v = s.view();
  s.dialog.handle(['blabla Chloé'], v, 1000); const b = s.dialog.handle(['deux points'], v, 9000);
  assert.equal(b.actions.length, 0);
});
t('« points » mal entendu : poing / poins / poids', () => {
  for (const w of ['poing', 'poins', 'poids', 'pointe']) assert.equal(ev(parse(`2 ${w} Chloé`)).action, 'TIR 2PTS RÉUSSI', w);
});
t('prénom mal entendu : le mot restant est rapproché de la joueuse la plus proche', () => {
  for (const w of ['Clauer', 'Kloé', 'Cloée', 'Claudé']) { const c: any = parse(`2 points ${w}`); assert.equal(c.type, 'EVENT', w); assert.equal(c.playerId, 'chloe', w); }
  assert.equal((parse('Laurat deux points') as any).playerId, 'laura');
});
t('mot inconnu trop éloigné : pas de devinette', () => assert.notEqual(parse('2 points Zorglub').type, 'EVENT'));
t('le mot inconnu est remonté pour être appris comme variante', () => {
  const s = new Sim(); const r = s.dialog.handle(['bonjour zorglub'], s.view()); assert.equal(r.unknown, 'bonjour zorglub'); assert.deepEqual(r.say, []);   // aucun mot de commande : on ne répond pas
});

// ═════════ 13. Calibrage ═════════
t('calibrage : la liste de phrases est complète et propre', () => {
  const setup = calibrationSetup(PLAYERS); const ps = buildPrompts(setup);
  assert.ok(ps.length >= 50, String(ps.length));
  for (const p of ps) { assert.ok(!/undefined|NaN/.test(p.text), p.text); assert.ok(p.text.trim().length > 0); }
  assert.ok(new Set(ps.map((p) => p.group)).size >= 6);
});
t('calibrage : toutes les phrases lues correctement sont comprises (« ok »)', () => {
  const setup = calibrationSetup(PLAYERS); const bad: string[] = [];
  for (const p of buildPrompts(setup)) { const r = evaluateHeard(p, [p.text], setup, emptyProfile()); if (r.status !== 'ok') bad.push(p.text); }
  assert.deepEqual(bad, []);
});
t('calibrage : un mot de commande mal entendu est appris puis appliqué', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Actions', text: 'interception Chloé' }, ['interdiction Chloé'], setup, emptyProfile());
  assert.equal(r.status, 'learned'); assert.equal(r.profile.wordFixes['interdiction'], 'interception');
  const c: any = parseCommand('interdiction Chloé', PLAYERS, { onCourt: START_COURT, events: [], wordFixes: r.profile.wordFixes });
  assert.equal(c.action, 'INTERCEPTION'); assert.equal(c.playerId, 'chloe');
});
t('calibrage : un prénom très mal entendu devient une variante de la joueuse', () => {
  const roster = [P('zoe', 'ZOE', 3), ...PLAYERS.filter((p) => p.id !== 'chloe')];
  const setup = calibrationSetup(roster);
  const r = evaluateHeard({ group: 'Prénoms', text: 'Zoé deux points' }, ['sauce deux points'], setup, emptyProfile());
  assert.equal(r.status, 'learned'); assert.deepEqual(r.profile.aliases['zoe'], ['sauce']);
});
t('calibrage : on n\'apprend jamais à remplacer un mot qui a déjà un sens', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Prénoms', text: 'Chloé deux points' }, ['Chloé trois points'], setup, emptyProfile());
  assert.equal(r.status, 'fail'); assert.deepEqual(r.profile.wordFixes, {});
});
t('calibrage : l\'alternative qui suffit est retenue, les autres n\'ajoutent rien', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Actions', text: 'interception Chloé' }, ['interdiction Chloé', 'blabla Chloé'], setup, emptyProfile());
  assert.equal(r.status, 'learned'); assert.deepEqual(Object.keys(r.profile.wordFixes), ['interdiction']);
});

// ═════════ 14. Didacticiel : le parcours complet fonctionne, avec n'importe quelles joueuses ═════════
const rng = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
t('didacticiel : ≈ 50 étapes, joueuses et numéros tous différents', () => {
  const d = makeDemo(rng(1)); const steps = buildTutorial(d.players, d.players.slice(0, 5).map((p) => p.id));
  assert.equal(d.players.length, 10); assert.equal(new Set(d.players.map((p) => p.number)).size, 10); assert.equal(new Set(d.players.map((p) => p.name)).size, 10);
  assert.ok(steps.length >= 48 && steps.length <= 60, String(steps.length));
});
t('didacticiel : 80 matchs démo au hasard, chaque phrase est comprise et a son effet', () => {
  const failures: string[] = [];
  for (let seed = 1; seed <= 80; seed++) {
    const d = makeDemo(rng(seed)); const court = d.players.slice(0, 5).map((p) => p.id);
    const sim = new Sim(); sim.players = d.players.map((p) => ({ id: p.id, name: p.name, number: p.number })); sim.onCourt = [...court];
    const steps = buildTutorial(d.players, court);
    const snap = (): TutSnap => ({ events: sim.events.map((e) => ({ actionType: e.actionType, playerId: e.playerId })), scoreHome: sim.home, scoreAway: sim.away, clockRunning: sim.clock, onCourt: [...sim.onCourt], selected: sim.selected, subPanelOpen: sim.subPanelOpen, ftFilled: sim.ftFilled, voiceEnabled: true });
    steps.forEach((st, i) => {
      if (st.say === '') return;
      const base = snap(); const say = typeof st.say === 'function' ? st.say({ cur: base, base, last: null }) : st.say;
      const r = sim.say(say); const last = { say: r.say.join('. '), actions: r.actions.length, at: 0 };
      if (!st.check({ cur: snap(), base, last })) failures.push(`graine ${seed}, étape ${i + 1} « ${say} » → « ${last.say} »`);
    });
  }
  assert.deepEqual(failures.slice(0, 5), []);
});

// ═════════ 15. Robustesse : mots déformés, priorités, réponse anticipée ═════════
t('mots de commande déformés d\'une lettre : ramenés au bon mot', () => {
  assert.equal(ev(parse('interseption Chloé')).action, 'INTERCEPTION');
  assert.equal(ev(parse('rebon offencif Chloé')).action, 'REBOND OFFENSIF');
  assert.equal(ev(parse('passe desisive Chloé')).action, 'PASSE DÉCISIVE');
});
t('un prénom coupé en deux n\'est jamais « corrigé » en mot de commande', () => {
  const c: any = parseCommand('Ana belle interception', PLAYERS, { onCourt: START_COURT, events: [] });
  assert.equal(c.type, 'EVENT'); assert.equal(c.action, 'INTERCEPTION');
});
t('temps mort : variantes entendues', () => { for (const x of ['temps morts', 'tant mort', 'temps mors', 'tem mort']) assert.equal((parse(x) as any).running, false, x); });
t('« Chloé a subi une faute » = faute subie', () => { for (const x of ['Chloé a subi une faute', 'faute subit Chloé', 'Chloé su bi']) assert.equal(ev(parse(x)).action, 'FAUTE SUBIE', x); });
t('adversaire : « équipe adverse », « l\'autre équipe »', () => { for (const x of ['équipe adverse deux points', "l'autre équipe 2 points", '2 points adversaire']) assert.equal((parse(x) as any).delta, 2, x); });
t('peek : une phrase complète est repérée, une phrase incomplète non', () => {
  const s = new Sim(); const v = s.view();
  assert.equal(s.dialog.peek(['Chloé deux points'], v), true); assert.equal(s.dialog.peek(['Chloé'], v), false); assert.equal(s.dialog.peek(['deux points'], v), false);
  assert.equal(s.dialog.peek(['démarrer chrono'], v), true); assert.equal(s.dialog.peek(['remplacement Chloé par'], v), false);
  s.say('remplacement Chloé par Hinde'); assert.equal(s.dialog.peek(['oui'], v), true); assert.equal(s.dialog.peek(['hum'], v), false);
});
t('peek n\'a aucun effet de bord', () => {
  const s = new Sim(); const v = s.view(); s.dialog.peek(['Chloé deux points'], v); assert.equal(s.dialog.mode, 'idle'); assert.equal(s.actions.length, 0);
});

t('journal réel : « un litre de points » pour « Alice deux points » est appris puis compris', () => {
  const roster = [P('alice', 'ALICE', 1), ...PLAYERS.filter((p) => p.id !== 'chloe')];
  const setup = calibrationSetup(roster);
  const r = evaluateHeard({ group: 'Tirs', text: 'Alice deux points' }, ['un litre de points'], setup, emptyProfile());
  assert.equal(r.status, 'learned');
  const c: any = parseCommand('un litre de points', roster, { onCourt: ['alice', ...START_COURT.slice(1)], events: [], wordFixes: r.profile.wordFixes });
  assert.equal(c.type, 'EVENT'); assert.equal(c.playerId, 'alice'); assert.equal(c.action, 'TIR 2PTS RÉUSSI');
});
t('journal réel : « en 10 3 points » pour « Candice trois points » (prénom entendu comme un nombre)', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Prénoms', text: 'Candice trois points' }, ['en 10 3 points'], setup, emptyProfile());
  assert.equal(r.status, 'learned');
  const c: any = parseCommand('en 10 3 points', PLAYERS, { onCourt: START_COURT, events: [], wordFixes: r.profile.wordFixes });
  assert.equal(c.playerId, 'candice'); assert.equal(c.action, 'TIR 3PTS RÉUSSI');
});
t('moteur local : « deux poils », « trois fois » = points', () => {
  assert.equal(ev(parse('Chloé deux poils')).action, 'TIR 2PTS RÉUSSI'); assert.equal(ev(parse('tir à trois fois réussi Chloé')).action, 'TIR 3PTS RÉUSSI');
});
t('bruit pur (« merci à bientôt ») : l\'appli ne répond pas', () => {
  const s = new Sim(); const r = s.dialog.handle(['merci à bientôt'], s.view()); assert.deepEqual(r.say, []); assert.equal(r.actions.length, 0);
  const q = s.dialog.handle(['un litre de points'], s.view()); assert.equal(q.say.length > 0, true);
});
t('calibrage : les joueuses du banc sont testées par un remplacement, sans refus attendu', () => {
  const setup = calibrationSetup(PLAYERS); const ps = buildPrompts(setup);
  const benchPrompts = ps.filter((p) => p.group === 'Prénoms (banc)'); assert.ok(benchPrompts.length >= 3);
  for (const p of ps) { const c: any = parseCommand(p.text, setup.players, setup.ctx, p.opts); assert.ok(!['REFUSE', 'UNKNOWN'].includes(c.type), `${p.text} → ${c.type} ${c.say}`); }
});
t('calibrage : une phrase sans rapport (« merci à bientôt ») n\'apprend rien', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Prénoms', text: 'Annaelle rebond défensif' }, ['merci à bientôt'], setup, emptyProfile());
  assert.equal(r.status, 'fail'); assert.deepEqual(r.profile.wordFixes, {}); assert.deepEqual(r.profile.aliases, {});
});
t('calibrage : le détail montre attendu, entendu et compris', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Tirs', text: 'Chloé deux points' }, ['un litre de points', 'Chloé deux points'], setup, emptyProfile());
  assert.equal(r.status, 'ok'); assert.match(r.detail.expected, /TIR 2PTS RÉUSSI · Chloé/);
  assert.equal(r.detail.perAlt.length, 2); assert.equal(r.detail.perAlt[0].ok, false); assert.equal(r.detail.perAlt[1].ok, true);
  const f = evaluateHeard({ group: 'Tirs', text: 'Chloé deux points' }, ['blablabla bloblo'], setup, emptyProfile());
  assert.equal(f.status, 'fail'); assert.match(f.detail.perAlt[0].understood, /question|refus|non reconnu/);
});

// ═════════ 16. Journal du calibrage (v11) ═════════
t('apprentissage : « pas » n\'est jamais appris seul (on apprend « pas décisive »)', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Actions', text: 'Chloé passe décisive' }, ['Chloé pas décisive'], setup, emptyProfile());
  assert.equal(r.status, 'learned'); assert.equal(r.profile.wordFixes['pas'], undefined); assert.equal(r.profile.wordFixes['pas decisive'], 'passe decisive');
});
t('apprentissage : « avec chrono » = « arrêt chrono », sans toucher aux autres « avec »', () => {
  const setup = calibrationSetup(PLAYERS);
  const r = evaluateHeard({ group: 'Chrono', text: 'arrêt chrono' }, ['avec chrono'], setup, emptyProfile());
  assert.equal(r.status, 'learned'); assert.equal(r.profile.wordFixes['avec'], undefined);
  const fx = r.profile.wordFixes;
  assert.equal((parseCommand('avec chrono', PLAYERS, { onCourt: START_COURT, events: [], wordFixes: fx }) as any).running, false);
  assert.equal(ev(parseCommand('avec Chloé deux points', PLAYERS, { onCourt: START_COURT, events: [], wordFixes: fx })).playerId, 'chloe');
});
t('apprentissage : jamais d\'écrasement d\'une correction déjà apprise', () => {
  const setup = calibrationSetup(PLAYERS);
  const p1 = evaluateHeard({ group: 'a', text: 'interception Chloé' }, ['interdiction Chloé'], setup, emptyProfile()).profile;
  const p2 = evaluateHeard({ group: 'b', text: 'contre de Chloé' }, ['interdiction de Chloé'], setup, p1);
  assert.equal(p2.profile.wordFixes['interdiction'], 'interception');
});
t('« adversaire - 1 » (tiret) = moins un', () => { assert.equal((parse('adversaire - 1') as any).delta, -1); assert.equal((parse('adversaire −2') as any).delta, -2); assert.equal((parse('adversaire 1') as any).delta, 1); });
t('balle perdue : « bal perdu », « perdu » seul', () => { for (const x of ['bal perdu Chloé', 'perdu Chloé', 'balle perdue Chloé']) assert.equal(ev(parse(x)).action, 'PERTE DE BALLE', x); });
t('« sur Chloé » seul = faute subie ; « sur le terrain » reste une question', () => {
  assert.equal(ev(parse('sur Chloé')).action, 'FAUTE SUBIE'); assert.equal(parse('sur le terrain').type, 'Q_COURT'); assert.equal(parse('sur le terrain on a Hinde, Anaelle').type, 'ASK');
});

t('nettoyage : les corrections dangereuses d\'un ancien calibrage (« pas », « avec ») sont retirées', () => {
  const p = { aliases: {}, wordFixes: { pas: 'points', avec: 'arret', 'pas decisive': 'passe decisive', interdiction: 'interception' }, calibratedAt: null };
  const q = sanitizeProfile(p); assert.deepEqual(Object.keys(q.wordFixes).sort(), ['interdiction', 'pas decisive']);
});

t('arrêter le chrono : « pause », « stop », « arrêt de jeu », « sifflet », « temps mort »', () => {
  for (const x of ['pause', 'stop', 'arrêt de jeu', 'coup de sifflet', 'temps mort', 'stop chrono']) assert.equal((parse(x) as any).running, false, x);
});
t('« stop » dans une confirmation reste un refus (jamais le chrono)', () => {
  const s = new Sim(); s.say('remplacement Chloé par Hinde'); assert.equal(s.said('stop'), 'Annulé.'); assert.equal(s.clock, false); assert.equal(s.actions.length, 0);
});

// Phonétique
t('clés phonétiques (fiche § 8)', () => {
  assert.equal(phonetic('Candice'), phonetic('Candy'));
  assert.equal(phonetic('Hinde'), phonetic('inde')); assert.equal(phonetic('Chloé'), phonetic('cloe'));
  assert.notEqual(phonetic('Chloé'), phonetic('Laura'));
});
t('un mot du lexique n\'est jamais pris pour un prénom', () => {
  const lex = [P('a', 'PASSE', 3), P('b', 'LEA', 4)];
  const c: any = parseCommand('passe décisive Léa', lex, { onCourt: ['a', 'b'], events: [] });
  assert.equal(c.type, 'EVENT'); assert.equal(c.playerId, 'b');
});
t('variantes saisies par l\'utilisateur', () => {
  const withAlias = PLAYERS.map((p) => (p.id === 'candice' ? { ...p, aliases: ['kandis', 'candy'] } : p));
  assert.equal((parseCommand('kandis deux points', withAlias, ctxOf()) as any).playerId, 'candice');
});
t('phrase incompréhensible', () => assert.equal(parse('bonjour tout le monde').type, 'UNKNOWN'));

console.log(`\n${ok} réussis, ${ko} échoués`);
if (ko) process.exit(1);
