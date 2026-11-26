// lib/voice/dialog.ts — machine à états de la commande vocale (confirmations, questions, lancers francs).
// Pure : reçoit le texte entendu + une photo du match, renvoie ce qu'il faut dire et faire.
// Aucun accès au navigateur ni à React : testable avec Node.

import {
  Cmd, ParseCtx, VoiceEventLite, VoicePlayer,
  countFouls, parseCommand, parseConfirm, parseNameAnswer, FT_ORDINALS,
} from './commands';

/** Photo du match au moment où la phrase est entendue. */
export interface VoiceView {
  players: VoicePlayer[];
  onCourt: string[];
  /** game.events : le plus récent en premier. */
  events: VoiceEventLite[];
  scoreHome: number;
  scoreAway: number;
  period: number;
  clockRunning: boolean;
  /** Joueuse sélectionnée à l'écran (joueuse par défaut si la phrase n'en nomme aucune). */
  selectedPlayerId?: string | null;
  /** Corrections apprises au calibrage (compte de l'utilisateur). */
  wordFixes?: Record<string, string>;
  /** Fenêtre de changement de l'écran : ouverte ? nombre de sorties / d'entrées déjà cochées. */
  subPanel?: { open: boolean; outCount: number; inCount: number };
}

/** Ce que l'interface doit exécuter (via les adaptateurs de page.tsx). */
export type VoiceAction =
  | { t: 'event'; action: string; playerId: string; points: number }
  | { t: 'opp'; delta: number }
  | { t: 'sub'; outs: string[]; ins: string[] }
  | { t: 'ft'; playerId: string; made: number; attempts: number }
  | { t: 'delete'; eventId: string }
  | { t: 'clock'; running: boolean }
  | { t: 'subPanel'; op: 'open' | 'close' | 'validate' }
  | { t: 'select'; playerId: string | null }
  /** Affiche la série de lancers francs en cours sur l'écran (playerId null : ne pas changer la sélection). */
  | { t: 'ftView'; playerId: string | null; attempts: [boolean | null, boolean | null, boolean | null] };

export interface DialogResult {
  /** Phrases à dire à voix haute, dans l'ordre. */
  say: string[];
  actions: VoiceAction[];
  /** Mots entendus mais non reconnus (pour proposer de les apprendre comme variante d'un prénom). */
  unknown?: string;
  /** Mode direct : la commande est incomplète ou ambiguë, rien n'a été fait et aucune question n'attend de réponse (bip d'erreur + texte à l'écran). */
  error?: boolean;
}

type FtAttempts = [boolean | null, boolean | null, boolean | null];

type State =
  | { mode: 'idle' }
  | { mode: 'confirm'; cmd: Cmd; retries: number }
  | { mode: 'ask'; kind: 'name'; text: string; key: string; candidates: string[]; prefer: Record<string, string>; retries: number }
  | { mode: 'ask'; kind: 'append'; text: string; retries: number }
  | { mode: 'ft'; playerId: string; label: string; attempts: FtAttempts };

export interface DialogOptions {
  /** « réussi » / « raté » seuls = tentative suivante, pendant une session de lancers francs (à confirmer). */
  ftBareNext?: boolean;
  /** « annule » pendant une session abandonne la session sans rien enregistrer (à confirmer). */
  ftCancelOnUndo?: boolean;
}

const nameOf = (players: VoicePlayer[], id: string) => {
  const p = players.find((x) => x.id === id);
  return p?.name ? p.name.charAt(0).toUpperCase() + p.name.slice(1).toLowerCase() : `numéro ${p?.number ?? '?'}`;
};

const ORD_FEM = ['première', 'deuxième', 'troisième'];
const FOUL_RANK: Record<number, string> = { 4: 'quatrième', 5: 'cinquième' };

export class VoiceDialog {
  private st: State = { mode: 'idle' };
  /** Dernier fragment non compris : une hésitation coupe parfois une phrase en deux, on recolle les morceaux (5 s). */
  private carry: { text: string; at: number } | null = null;
  private pendingSay = '';   // dernière question posée (pour distinguer une réponse d'une nouvelle commande)
  private readonly opts: Required<DialogOptions>;
  /** Mode DIRECT : jamais de question en attente. Une commande incomplète est refusée tout de suite ; une égalité entre deux prénoms prend le premier. */
  private direct = false;

  constructor(opts: DialogOptions = {}) {
    this.opts = { ftBareNext: opts.ftBareNext ?? true, ftCancelOnUndo: opts.ftCancelOnUndo ?? true };
  }

  get mode(): State['mode'] { return this.st.mode; }

  /** Active / désactive le mode DIRECT. En passant en direct, toute attente en cours est abandonnée. */
  setDirect(on: boolean): void {
    if (on && !this.direct) { this.st = { mode: 'idle' }; this.carry = null; }
    this.direct = on;
  }

  /** Texte d'état pour l'écran. */
  status(view?: Pick<VoiceView, 'players'>): string {
    const s = this.st;
    if (s.mode === 'confirm') return 'En attente de « oui » / « non »';
    if (s.mode === 'ask') return 'Question posée : répondez à voix haute';
    if (s.mode === 'ft') {
      const n = s.attempts.filter((a) => a !== null).length;
      const m = s.attempts.filter((a) => a === true).length;
      return `Lancers francs ${s.label} (${m}/${n})`;
    }
    void view;
    return 'À l’écoute';
  }

  /** Abandon manuel (bouton de l'écran) : sans rien enregistrer. */
  cancel(): void { this.st = { mode: 'idle' }; }

  /** Les alternatives de la reconnaissance, la plus probable d'abord. */
  handle(alternatives: string[], view: VoiceView, now: number = Date.now()): DialogResult {
    const alts = alternatives.map((a) => a.trim()).filter(Boolean);
    if (!alts.length) return { say: [], actions: [] };
    const st = this.st;

    // « Abandon » : quitte n'importe quelle attente (question, confirmation, série de lancers francs) et efface un fragment en cours.
    if (alts.some((a) => /\b(?:abandon(?:ne|ner|nez|s)?|ignor(?:e|er|ez)|oubli(?:e|er|ez)|tant pis)\b/.test(a.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))) {
      this.carry = null;
      this.st = { mode: 'idle' };
      if (st.mode === 'idle') return { say: [], actions: [] };
      return { say: ['Abandon.'], actions: st.mode === 'ft' ? [{ t: 'ftView', playerId: null, attempts: [null, null, null] }] : [] };
    }

    if (st.mode === 'confirm') return this.onConfirm(alts, st, view);
    if (st.mode === 'ask') return this.onAsk(alts, st, view);
    if (st.mode === 'ft') return this.onFt(alts, st, view);
    return this.onIdle(alts, view, now);
  }

  /** La phrase (provisoire) est-elle déjà une commande complète ? Sans aucun effet de bord : sert à répondre plus tôt. */
  peek(alternatives: string[], view: VoiceView): boolean {
    const alts = alternatives.map((a) => a.trim()).filter(Boolean);
    if (!alts.length) return false;
    const st = this.st;
    const complete = (c: Cmd) => c.type !== 'UNKNOWN' && c.type !== 'REFUSE' && c.type !== 'ASK';
    if (st.mode === 'confirm') return alts.some((a) => parseConfirm(a) !== null);
    if (st.mode === 'ask') return false;
    if (st.mode === 'ft') return complete(this.best(alts, view, undefined, true).cmd);
    return complete(this.best(alts, view).cmd);
  }

  // ───────── contexte d'analyse
  private ctx(view: VoiceView, prefer?: Record<string, string>): ParseCtx {
    return { onCourt: view.onCourt, events: view.events, prefer, requireOnCourt: true, subPanelOpen: !!view.subPanel?.open, selectedId: view.selectedPlayerId ?? null, wordFixes: view.wordFixes };
  }

  /** Première alternative qui donne une commande exécutable ; à défaut la meilleure explication. */
  private best(alts: string[], view: VoiceView, prefer?: Record<string, string>, ftSession = false): { cmd: Cmd; text: string } {
    const rank = (c: Cmd) => (c.type === 'UNKNOWN' ? 0 : c.type === 'REFUSE' ? 1 : c.type === 'ASK' ? 2 : 3);
    let best: { cmd: Cmd; text: string } | null = null;
    for (const text of alts) {
      const cmd = parseCommand(text, view.players, this.ctx(view, prefer), { ftSession, ftBareNext: this.opts.ftBareNext });
      if (!best || rank(cmd) > rank(best.cmd)) best = { cmd, text };
      if (rank(cmd) === 3) break;
    }
    return best as { cmd: Cmd; text: string };
  }

  /** Une phrase qui est à elle seule une commande complète (et non la réponse à une question en attente). */
  private fresh(alts: string[], view: VoiceView): { cmd: Cmd; text: string } | null {
    const r = this.best(alts, view);
    return r.cmd.type === 'UNKNOWN' || r.cmd.type === 'REFUSE' || r.cmd.type === 'ASK' ? null : r;
  }

  // ───────── état « repos »
  private onIdle(alts: string[], view: VoiceView, now: number): DialogResult {
    const first = this.best(alts, view);
    const complete = (c: Cmd) => c.type !== 'UNKNOWN' && c.type !== 'REFUSE' && c.type !== 'ASK';
    if (complete(first.cmd)) { this.carry = null; return this.run(first.cmd, first.text, view); }
    // Fragment : on le recolle au précédent s'il est récent (« Chloé » … pause … « deux points »).
    if (this.carry && now - this.carry.at < 5000) {
      const j = this.fresh(alts.map((a) => `${this.carry!.text} ${a}`), view);
      if (j) { this.carry = null; return this.run(j.cmd, j.text, view); }
    }
    this.carry = first.cmd.type === 'UNKNOWN' ? { text: first.text, at: now } : null;
    const res = this.run(first.cmd, first.text, view);
    if (first.cmd.type === 'UNKNOWN' && first.cmd.heard) res.unknown = first.cmd.heard;
    return res;
  }

  /** Exécute (ou prépare) une commande analysée. */
  private run(cmd: Cmd, text: string, view: VoiceView): DialogResult {
    const players = view.players;
    switch (cmd.type) {
      case 'UNKNOWN': return { say: cmd.noise ? [] : [cmd.say], actions: [] };   // aucun mot reconnu : on ne répond pas (bruit, conversation)
      case 'REFUSE': return { say: [cmd.say], actions: [] };
      case 'NOOP': return { say: [cmd.say], actions: [] };
      case 'ASK':
        if (this.direct) {
          // Égalité entre deux prénoms : on prend le premier (affiché à l'écran ; « annule » corrige).
          if (cmd.kind === 'name' && cmd.candidates.length) {
            const again = this.best([text], view, { [cmd.key]: cmd.candidates[0] });
            if (again.cmd.type !== 'ASK' && again.cmd.type !== 'UNKNOWN' && again.cmd.type !== 'REFUSE') return this.run(again.cmd, again.text, view);
          }
          // Liste « sur le terrain on a… » encore incomplète : on garde le début en mémoire (sans parler) pour recoller la suite.
          if (cmd.kind === 'append' && cmd.progress) {
            this.st = { mode: 'ask', kind: 'append', text, retries: 0 };
            this.pendingSay = cmd.say;
            return { say: [cmd.say], actions: [] };
          }
          // Tout le reste : pas de question. On dit ce qui manque à l'écran, on bipe, et on repart à zéro.
          return { say: [cmd.say], actions: [], error: true };
        }
        if (cmd.kind === 'name') {
          this.st = { mode: 'ask', kind: 'name', text, key: cmd.key, candidates: cmd.candidates, prefer: {}, retries: 0 };
        } else {
          this.st = { mode: 'ask', kind: 'append', text, retries: 0 };
        }
        this.pendingSay = cmd.say;
        return { say: [cmd.say], actions: [] };

      case 'EVENT': {
        if (cmd.needsConfirm) {
          this.st = { mode: 'confirm', cmd, retries: 0 };
          return { say: [`${cmd.say}. Valide ?`], actions: [] };
        }
        return this.doEvent(cmd, view);
      }
      case 'FREE_THROWS':
        return { say: [cmd.say], actions: [{ t: 'ft', playerId: cmd.playerId, made: cmd.made, attempts: cmd.attempts }] };
      case 'FT_START':
        this.st = { mode: 'ft', playerId: cmd.playerId, label: nameOf(players, cmd.playerId), attempts: [null, null, null] };
        return { say: [cmd.say], actions: [{ t: 'ftView', playerId: cmd.playerId, attempts: [null, null, null] }] };
      case 'OPP':
        return { say: [cmd.say], actions: [{ t: 'opp', delta: cmd.delta }] };
      case 'UNDO':
        if (!cmd.eventId || !view.events.some((e) => e.id === cmd.eventId)) return { say: ['Rien à annuler.'], actions: [] };
        return { say: [cmd.say], actions: [{ t: 'delete', eventId: cmd.eventId }] };
      // Changements : exécutés tout de suite, sans « oui » (décision : saisie rapide). Une erreur se corrige par un nouveau changement.
      case 'SUB': {
        const ids = new Set(view.onCourt);
        const stale = cmd.ins.some((id) => ids.has(id));
        if (stale) return { say: ['Changement impossible, le terrain a changé.'], actions: [] };
        return { say: [cmd.say], actions: [{ t: 'sub', outs: cmd.outs, ins: cmd.ins }] };
      }
      case 'SET_COURT':
        if (view.onCourt.length > 0) return { say: ['Le terrain a changé. Redis la liste.'], actions: [] };
        return { say: [cmd.say], actions: [{ t: 'sub', outs: [], ins: cmd.ins }] };
      case 'CLOCK': {
        if (cmd.running === view.clockRunning) return { say: [cmd.running ? 'Chrono déjà lancé' : 'Chrono déjà arrêté'], actions: [] };
        return { say: [cmd.say], actions: [{ t: 'clock', running: cmd.running }] };
      }
      case 'SELECT':
        return { say: [cmd.say], actions: [{ t: 'select', playerId: cmd.playerId }] };
      case 'SUBPANEL': {
        const sp = view.subPanel;
        if (cmd.op === 'open') return { say: [cmd.say], actions: [{ t: 'subPanel', op: 'open' }] };
        if (cmd.op === 'close') return { say: [cmd.say], actions: sp?.open ? [{ t: 'subPanel', op: 'close' }] : [] };
        if (!sp?.open) return { say: ['Aucun changement ouvert.'], actions: [] };
        if (sp.outCount === 0 || sp.outCount !== sp.inCount) return { say: ["Il faut autant de sorties que d'entrées."], actions: [] };
        return { say: [cmd.say], actions: [{ t: 'subPanel', op: 'validate' }] };
      }
      case 'Q_SCORE':
        return { say: [`Nous ${view.scoreHome}, eux ${view.scoreAway}`], actions: [] };
      case 'Q_COURT': {
        const names = view.onCourt.map((id) => nameOf(players, id));
        return { say: [names.length ? `Sur le terrain : ${names.join(', ')}` : 'Personne sur le terrain'], actions: [] };
      }
      case 'Q_FOULS': {
        const n = countFouls(view.events, cmd.playerId);
        return { say: [`${nameOf(players, cmd.playerId)}, ${n} ${n > 1 ? 'fautes' : 'faute'}`], actions: [] };
      }
      case 'Q_TEAM_FOULS': {
        const n = view.events.filter((e) => e.period === view.period && e.actionType.includes('FAUTE') && !e.actionType.includes('SUBIE')).length;
        return { say: [`${n} ${n > 1 ? 'fautes' : 'faute'} d'équipe`], actions: [] };
      }
      // Ces commandes n'existent que pendant une session de lancers francs.
      case 'FT_ATTEMPT':
      case 'FT_DONE':
      case 'FT_RATIO':
        return { say: ["Dis d'abord lancer franc, puis le nom."], actions: [] };
    }
  }

  private doEvent(cmd: Extract<Cmd, { type: 'EVENT' }>, view: VoiceView): DialogResult {
    const say = [cmd.say];
    const actions: VoiceAction[] = [{ t: 'event', action: cmd.action, playerId: cmd.playerId, points: cmd.points }];
    if (cmd.action.includes('FAUTE') && !cmd.action.includes('SUBIE')) {
      const after = countFouls([{ id: '_new', actionType: cmd.action, playerId: cmd.playerId }, ...view.events], cmd.playerId);
      const who = cmd.designation;
      if (cmd.action.includes('DISQUALIFIANTE')) say[0] = `${cmd.say}, disqualifiée, elle sort`;
      else if (after >= 5 && cmd.action.includes('ANTISPORTIVE')) say[0] = `${cmd.say}, deuxième antisportive, elle sort`;
      else if (after >= 5) say[0] = `${who}, cinquième faute, elle sort`;
      else if (after === 4) say[0] = `${cmd.say}, ${FOUL_RANK[4]} faute`;
    }
    return { say, actions };
  }

  // ───────── confirmation « oui / non »
  private onConfirm(alts: string[], st: Extract<State, { mode: 'confirm' }>, view: VoiceView): DialogResult {
    let ans: 'yes' | 'no' | null = null;
    for (const a of alts) { ans = parseConfirm(a); if (ans) break; }
    if (ans === 'no') { this.st = { mode: 'idle' }; return { say: ['Annulé.'], actions: [] }; }
    if (!ans) {
      const nf = this.fresh(alts, view);
      if (nf) { this.st = { mode: 'idle' }; return this.run(nf.cmd, nf.text, view); } // nouvelle commande : l'attente est abandonnée
      if (st.retries >= 1) { this.st = { mode: 'idle' }; return { say: ['Annulé.'], actions: [] }; }
      this.st = { ...st, retries: st.retries + 1 };
      return { say: ['Oui ou non ?'], actions: [] };
    }
    this.st = { mode: 'idle' };
    const cmd = st.cmd;
    const ids = new Set(view.onCourt);
    switch (cmd.type) {
      case 'EVENT': return this.doEvent(cmd, view);
      case 'SUB': {
        const stale = cmd.ins.some((id) => ids.has(id)) || cmd.outs.some((id) => !ids.has(id) && countFouls(view.events, id) < 5);
        if (stale) return { say: ['Changement impossible, le terrain a changé.'], actions: [] };
        return { say: ['Changement enregistré.'], actions: [{ t: 'sub', outs: cmd.outs, ins: cmd.ins }] };
      }
      case 'SET_COURT': {
        if (view.onCourt.length > 0) return { say: ['Le terrain a changé. Redis la liste.'], actions: [] };
        return { say: ['Cinq de départ enregistré.'], actions: [{ t: 'sub', outs: [], ins: cmd.ins }] };
      }
      default: return { say: [], actions: [] };
    }
  }

  // ───────── question posée (« Annabelle ou Annaelle ? », « Quelle joueuse ? »…)
  private onAsk(alts: string[], st: Extract<State, { mode: 'ask' }>, view: VoiceView): DialogResult {
    for (const a of alts) { if (parseConfirm(a) === 'no') { this.st = { mode: 'idle' }; return { say: ['Annulé.'], actions: [] }; } }
    const giveUp = (): DialogResult => {
      if (st.retries >= 1) { this.st = { mode: 'idle' }; return { say: ['Annulé.'], actions: [] }; }
      this.st = { ...st, retries: st.retries + 1 };
      return { say: ['Commande non reconnue.'], actions: [] };
    };
    // Une commande complète dite à la place de la réponse annule la question en attente et passe à la nouvelle.
    const startNew = (): DialogResult | null => {
      const nf = this.fresh(alts, view);
      if (!nf) return null;
      this.st = { mode: 'idle' };
      return this.run(nf.cmd, nf.text, view);
    };
    if (st.kind === 'name') {
      let chosen: string | null = null;
      for (const a of alts) { chosen = parseNameAnswer(a, view.players, st.candidates); if (chosen) break; }
      if (!chosen) return startNew() ?? giveUp();
      this.st = { mode: 'idle' };
      const prefer = { ...st.prefer, [st.key]: chosen };
      const { cmd, text } = this.best([st.text], view, prefer);
      return this.run(cmd, text, view);
    }
    // « append » : une commande complète passe d'abord ; sinon on recolle la réponse à la phrase d'origine (« rebond » + « offensif »)
    const nw = startNew();
    if (nw) return nw;
    // Question « Quelle joueuse ? » en attente et nouvelle commande SANS joueuse (« raté à deux points ») : c'est une nouvelle commande qui remplace l'ancienne
    // (la recoller à l'ancienne donnait « Commande non reconnue »). Une réponse (un prénom seul) reste recollée.
    if (/^Quelle joueuse/.test(this.pendingSay)) {
      const standalone = this.best(alts, view);
      if (standalone.cmd.type === 'ASK' && standalone.cmd.kind === 'append' && /^Quelle joueuse/.test(standalone.cmd.say)) return this.run(standalone.cmd, standalone.text, view);
    }
    const joined = alts.map((a) => `${st.text} ${a}`);
    const { cmd, text } = this.best(joined, view);
    // liste « sur le terrain » encore incomplète : on garde l'attente et on la prolonge
    if (cmd.type === 'ASK' && cmd.kind === 'append' && cmd.progress) {
      this.st = { mode: 'ask', kind: 'append', text, retries: 0 };
      return { say: [cmd.say], actions: [] };
    }
    if (cmd.type === 'UNKNOWN' || cmd.type === 'ASK') return giveUp();
    this.st = { mode: 'idle' };
    return this.run(cmd, text, view);
  }

  // ───────── session de lancers francs
  private closeFt(st: Extract<State, { mode: 'ft' }>): DialogResult {
    const done = st.attempts.filter((a) => a !== null).length;
    const made = st.attempts.filter((a) => a === true).length;
    this.st = { mode: 'idle' };
    if (!done) return { say: ['Rien à enregistrer.'], actions: [{ t: 'ftView', playerId: null, attempts: [null, null, null] }] };
    return {
      say: [`${st.label}, lancers francs, ${made} sur ${done}`],
      actions: [{ t: 'ft', playerId: st.playerId, made, attempts: done }],
    };
  }

  private onFt(alts: string[], st: Extract<State, { mode: 'ft' }>, view: VoiceView): DialogResult {
    if (this.opts.ftCancelOnUndo && alts.some((a) => /\b(annule|annuler|annulation|abandonne|abandon|ignore|ignorer|oublie|laisse tomber)\b/i.test(a.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
      this.st = { mode: 'idle' };
      return { say: ['Lancers francs abandonnés.'], actions: [{ t: 'ftView', playerId: null, attempts: [null, null, null] }] };
    }
    const { cmd, text } = this.best(alts, view, undefined, true);

    switch (cmd.type) {
      case 'FT_ATTEMPT': {
        const a = st.attempts;
        let idx: number;
        if (cmd.index === null) {
          idx = a.findIndex((v) => v === null);
          if (idx === -1) return { say: ['Trois tentatives au maximum. Dis terminé.'], actions: [] };
        } else {
          idx = cmd.index;
          if (idx > 0 && a[idx - 1] === null) {
            const first = a.findIndex((v) => v === null);
            return { say: [`${FT_ORDINALS[first].charAt(0).toUpperCase()}${FT_ORDINALS[first].slice(1)} ?`], actions: [] };
          }
        }
        const next = [...a] as FtAttempts;
        next[idx] = cmd.made;
        const said = `${ORD_FEM[idx].charAt(0).toUpperCase()}${ORD_FEM[idx].slice(1)} ${cmd.made ? 'réussi' : 'raté'}`;
        if (next.every((v) => v !== null)) {
          // trois tentatives : la série est complète, on enregistre sans attendre « terminé »
          const closed = this.closeFt({ ...st, attempts: next });
          return { say: closed.say, actions: closed.actions };
        }
        this.st = { ...st, attempts: next };
        return { say: [said], actions: [{ t: 'ftView', playerId: null, attempts: next }] };
      }
      case 'FT_DONE': return this.closeFt(st);
      case 'FT_RATIO': {
        this.st = { mode: 'idle' };
        return {
          say: [`${st.label}, lancers francs, ${cmd.made} sur ${cmd.attempts}`],
          actions: [{ t: 'ft', playerId: st.playerId, made: cmd.made, attempts: cmd.attempts }],
        };
      }
      case 'UNKNOWN': case 'REFUSE': case 'ASK':
        return { say: [cmd.say], actions: [] };
      default: {
        // Toute autre commande reconnue : la session est d'abord enregistrée, puis la commande est traitée.
        const closed = this.closeFt(st);
        const next = this.run(cmd, text, view);
        return { say: [...closed.say, ...next.say], actions: [...closed.actions, ...next.actions] };
      }
    }
  }
}
