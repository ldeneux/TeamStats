'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Configuration Supabase
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://votre-projet.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'votre-cle-anon';

// Chaque requête réseau est abandonnée au bout de 20 s : avec un réseau faible dans une salle, mieux vaut
// échouer vite (et basculer sur l'enregistrement local) que rester bloqué sans fin.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  if (init?.signal) init.signal.addEventListener('abort', () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'multisports' },
  global: { fetch: fetchWithTimeout }
});

export interface Player { id: string; number: number; name: string; }
export interface SavedTeam { id: string; name: string; roster: Player[]; }
export interface GameEvent { id: string; timestamp: string; period: number; clockTime: string; actionType: string; playerId: string; details?: any; }

export interface GameConfig {
  teamHome: string;
  teamAway: string;
  matchDate: string;
  periodCount: number;
  periodMinutes: number;
  ffbbMatchId: string;
}

export interface GameState {
  config: GameConfig;
  period: number;
  clockSeconds: number;
  isClockRunning: boolean;
  scoreHome: number;
  scoreAway: number;
  scoreByPeriod: { [period: number]: { home: number; away: number } };
  matchRoster: Player[];
  onCourtPlayerIds: string[];
  events: GameEvent[];
}

const DEFAULT_PLAYERS: Player[] = [];

// Prolongations : OT1, OT2... de 5 minutes, uniquement à partir de U13 et en cas d'égalité.
// Une prolongation est une période de numéro > nombre de périodes du match (Q4 -> OT1 = période 5),
// ce qui réutilise tel quel le stockage existant (événements, stats par période, score par période).
const OVERTIME_MINUTES = 5;

// Points rapportés par une action (tir réussi, lancers francs réussis).
const pointsOfAction = (act: string) => {
  if (act.includes('TIR 3PTS') && !act.includes('Manqué')) return 3;
  if (act.includes('TIR 2PTS') && !act.includes('Manqué')) return 2;
  if (act.includes('LANCERS FRANCS')) {
    const m = act.match(/\((\d+)\/\d+\)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  return 0;
};

// Catégorie lue dans un libellé ("SATHONAY U15F - 2026/2027", "U15F", division...).
const parseCategory = (label: string | null | undefined) => {
  const m = /\bU\s?(\d{1,2})\s*([FMG])?/i.exec(label || '');
  return m ? { n: parseInt(m[1], 10), g: (m[2] || '').toUpperCase() } : null;
};
// U13 et + (une équipe sans "U" dans son nom est considérée comme senior).
const categoryAllowsOvertime = (teamName: string) => {
  const c = parseCategory(teamName);
  return c ? c.n >= 13 : true;
};
// Une des étiquettes (catégorie, équipe, division...) correspond-elle à la catégorie de l'équipe ?
const sameCategory = (teamName: string, labels: (string | null | undefined)[]) => {
  const t = parseCategory(teamName);
  if (!t) return false;
  return labels.some(l => {
    const c = parseCategory(l);
    return !!c && c.n === t.n && (!c.g || !t.g || c.g === t.g);
  });
};

const sortPlayersAlpha = (players: Player[]) => [...players].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));


// ---------------------------------------------------------------------------
// MODE HORS LIGNE : stockage local, file d'envoi, enregistrement d'un match complet
// ---------------------------------------------------------------------------
type PlayingTimeMap = { [playerId: string]: { [period: number]: number } };

const periodLabelOf = (pNum: number, totalPeriods: number) => {
  if (pNum > totalPeriods) return `OT${pNum - totalPeriods}`;
  return totalPeriods === 4 ? `Q${pNum}` : `P${pNum}`;
};
const formatClock = (secs: number) => {
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
};

const LS_OFFLINE_USER = 'teamstats:offline-user:v1';
const LS_PENDING = 'teamstats:pending:v1';
const lsKey = (base: string, userId: string) => `teamstats:${base}:v1:${userId}`;
const lsRead = <T,>(key: string, fallback: T): T => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const lsWrite = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // stockage plein ou indisponible
  }
};
const lsRemove = (key: string) => {
  try { window.localStorage.removeItem(key); } catch { /* rien */ }
};

// Erreur due au réseau (hors ligne, coupure, délai dépassé) : on bascule alors sur l'enregistrement local.
const isNetworkError = (err: any) => {
  const msg = String(err?.message ?? err ?? '');
  return (typeof navigator !== 'undefined' && navigator.onLine === false)
    || err?.name === 'AbortError'
    || /failed to fetch|networkerror|network request failed|load failed|fetch failed|abort|timed? ?out|err_internet|err_network/i.test(msg);
};

// Tout ce qu'il faut pour (ré)écrire un match en base, figé au moment où on appuie sur Enregistrer.
interface MatchSnapshot {
  ffbbId: string;
  matchConfig: GameConfig;
  homeAway: 'DOMICILE' | 'EXTERIEUR';
  game: GameState;
  playingTime: PlayingTimeMap;
  startingFiveByPeriod: { [period: number]: string[] };
  savedAt: number;
}
interface PendingItem { userId: string; snap: MatchSnapshot; lastError?: string; }

const readPending = (): PendingItem[] => lsRead<PendingItem[]>(LS_PENDING, []);
const writePending = (items: PendingItem[]) => lsWrite(LS_PENDING, items);
// Un seul envoi en attente par match : chaque enregistrement réécrit tout le match, le plus récent suffit.
const enqueuePending = (userId: string, snap: MatchSnapshot) => {
  const others = readPending().filter(i => !(i.userId === userId && i.snap.ffbbId === snap.ffbbId));
  return writePending([...others, { userId, snap }]);
};
const removePending = (userId: string, ffbbId: string, savedAt?: number) => {
  writePending(readPending().filter(i => !(i.userId === userId && i.snap.ffbbId === ffbbId && (savedAt === undefined || i.snap.savedAt === savedAt))));
};

const fingerprintOf = (g: GameState) => [g.events.length, g.scoreHome, g.scoreAway, g.period, Object.keys(g.scoreByPeriod).length].join('|');

function computePlayerStats(gameEvents: GameEvent[], playingTime: PlayingTimeMap, playerId: string, periodFilter: number | 'ALL') {
    const eventsToAnalyze = gameEvents.filter(e => {
      const matchPlayer = e.playerId === playerId;
      const matchPeriod = periodFilter === 'ALL' ? true : e.period === periodFilter;
      return matchPlayer && matchPeriod;
    });

    let points = 0, fouls = 0, foulsDrawn = 0, ftMade = 0, ftAttempted = 0, pts2Made = 0, pts2Att = 0, pts3Made = 0, pts3Att = 0;
    let rebOff = 0, rebDef = 0, assists = 0;
    let steals = 0, turnovers = 0, blocks = 0, blocksAgainst = 0;

    eventsToAnalyze.forEach(ev => {
      const act = ev.actionType;
      // Comparaisons exactes : 'CONTRE' est contenu dans 'CONTRE SUBI'.
      if (act === 'INTERCEPTION') steals++;
      else if (act === 'PERTE DE BALLE') turnovers++;
      else if (act === 'CONTRE') blocks++;
      else if (act === 'CONTRE SUBI') blocksAgainst++;
      if (act.includes('FAUTE SUBIE')) foulsDrawn++;
      else if (act.includes('FAUTE')) fouls++;
      if (act.includes('PASSE DÉCISIVE')) assists++;
      if (act.includes('REBOND OFFENSIF')) rebOff++;
      if (act.includes('REBOND DÉFENSIF')) rebDef++;
      if (act.includes('TIR 2PTS')) {
        pts2Att++;
        if (!act.includes('Manqué')) { pts2Made++; points += 2; }
      }
      if (act.includes('TIR 3PTS')) {
        pts3Att++;
        if (!act.includes('Manqué')) { pts3Made++; points += 3; }
      }
      if (act.includes('LANCERS FRANCS')) {
        const match = act.match(/\((\d+)\/(\d+)\)/);
        if (match) {
          const made = parseInt(match[1], 10);
          ftMade += made;
          ftAttempted += parseInt(match[2], 10);
          points += made;
        }
      }
    });

    let totalSecs = 0;
    if (playingTime[playerId]) {
      if (periodFilter === 'ALL') {
        totalSecs = Object.values(playingTime[playerId]).reduce((a, b) => a + b, 0);
      } else {
        totalSecs = playingTime[playerId][periodFilter] || 0;
      }
    }

    // Évaluation (formule FIBA) = (points + rebonds + passes décisives + interceptions + contres + fautes subies)
    //                            - (tirs manqués + lancers francs manqués + balles perdues + fautes commises + contres subis).
    const missedShots = (pts2Att - pts2Made) + (pts3Att - pts3Made);
    const missedFt = ftAttempted - ftMade;
    const evaluation = points + rebOff + rebDef + assists + steals + blocks + foulsDrawn
      - missedShots - missedFt - turnovers - fouls - blocksAgainst;

    return { points, totalSecs, fouls, foulsDrawn, ftMade, ftAttempted, pts2Made, pts2Att, pts3Made, pts3Att, rebOff, rebDef, assists, steals, turnovers, blocks, blocksAgainst, evaluation };
  }

// Écrit (ou réécrit entièrement) un match, ses événements et ses statistiques. Idempotent : on peut le relancer
// après une coupure, il repart de zéro pour ce match. Renvoie l'identifiant du match en base.
async function persistMatchSnapshot(snap: MatchSnapshot): Promise<string> {
  const check = (res: { error: any }, step: string) => {
    if (res.error) throw new Error(`${step} : ${res.error.message}`);
  };
  // Les colonnes des nouvelles statistiques viennent de sql/stats_extra_columns.sql : si ce script n'a pas
  // encore été exécuté, on enregistre quand même tout le reste (elles se recalculent à partir de l'historique).
  const EXTRA_STAT_KEYS = ['steals', 'turnovers', 'blocks', 'blocks_against'];
  const insertStatsRows = async (table: string, rows: any[], step: string) => {
    let res = await supabase.from(table).insert(rows);
    if (res.error && /steals|turnovers|blocks|schema cache/i.test(res.error.message)) {
      res = await supabase.from(table).insert(rows.map(r => {
        const copy = { ...r };
        EXTRA_STAT_KEYS.forEach(k => delete copy[k]);
        return copy;
      }));
    }
    check(res, step);
  };
  const statsOf = (playerId: string, periodFilter: number | 'ALL') =>
    computePlayerStats(snap.game.events, snap.playingTime, playerId, periodFilter);

  const { data: savedMatch, error: matchErr } = await supabase
    .from('stats_matches')
    .upsert({
      ffbb_match_id: snap.ffbbId,
      match_date: snap.matchConfig.matchDate,
      // En base, "home" = vrai domicile (notre équipe si DOM, l'adversaire si EXT).
      // On part toujours des valeurs en direct du formulaire (matchConfig), jamais de
      // l'instantané game.config figé au dernier "Démarrer / Mettre à jour le match" :
      // sinon un nom d'équipe ou une date corrigés après coup ne seraient pas sauvegardés.
      team_home: snap.homeAway === 'DOMICILE' ? snap.matchConfig.teamHome : snap.matchConfig.teamAway,
      team_away: snap.homeAway === 'DOMICILE' ? snap.matchConfig.teamAway : snap.matchConfig.teamHome,
      score_home: snap.homeAway === 'DOMICILE' ? snap.game.scoreHome : snap.game.scoreAway,
      score_away: snap.homeAway === 'DOMICILE' ? snap.game.scoreAway : snap.game.scoreHome,
      period_count: snap.matchConfig.periodCount,
      period_minutes: snap.matchConfig.periodMinutes,
      current_period: periodLabelOf(snap.game.period, snap.game.config.periodCount),
      current_timer: snap.game.clockSeconds
    }, { onConflict: 'ffbb_match_id' })
    .select()
    .single();

  if (matchErr || !savedMatch) throw new Error(`stats_matches : ${matchErr?.message || 'aucune ligne renvoyée'}`);
  const matchId = savedMatch.id;

  check(await supabase.from('stats_match_events').delete().eq('match_id', matchId), 'stats_match_events (suppression)');
  if (snap.game.events.length > 0) {
    check(await supabase.from('stats_match_events').insert(
      snap.game.events.map(ev => ({
        match_id: matchId,
        period: ev.period,
        clock_time: ev.clockTime,
        timestamp_str: ev.timestamp,
        player_id: ev.playerId,
        action_type: ev.actionType
      }))
    ), 'stats_match_events (événements)');
  }
  if (snap.game.onCourtPlayerIds.length > 0) {
    check(await supabase.from('stats_match_events').insert(
      snap.game.onCourtPlayerIds.map(playerId => ({
        match_id: matchId,
        period: snap.game.period,
        clock_time: formatClock(snap.game.clockSeconds),
        timestamp_str: new Date().toLocaleTimeString(),
        player_id: playerId,
        action_type: 'ETAT:SUR_TERRAIN'
      }))
    ), 'stats_match_events (joueuses sur le terrain)');
  }
  const scorePeriodEntries = Object.entries(snap.game.scoreByPeriod);
  if (scorePeriodEntries.length > 0) {
    check(await supabase.from('stats_match_events').insert(
      scorePeriodEntries.map(([period, s]) => {
        // Même convention "vrai domicile/extérieur" que team_home/score_home ci-dessus.
        const dbHome = snap.homeAway === 'DOMICILE' ? s.home : s.away;
        const dbAway = snap.homeAway === 'DOMICILE' ? s.away : s.home;
        return {
          match_id: matchId,
          period: Number(period),
          clock_time: formatClock(snap.game.clockSeconds),
          timestamp_str: new Date().toLocaleTimeString(),
          player_id: '',
          action_type: `ETAT:SCORE_PERIODE:${dbHome}-${dbAway}`
        };
      })
    ), 'stats_match_events (score par période)');
  }

  check(await supabase.from('stats_player_game_stats').delete().eq('match_id', matchId), 'stats_player_game_stats (suppression)');
  if (snap.game.matchRoster.length > 0) {
    await insertStatsRows('stats_player_game_stats',
      snap.game.matchRoster.map(p => {
        const st = statsOf(p.id, 'ALL');
        return {
          match_id: matchId,
          player_id: p.id,
          player_number: p.number,
          player_name: p.name,
          points: st.points,
          pts2_made: st.pts2Made,
          pts2_att: st.pts2Att,
          pts3_made: st.pts3Made,
          pts3_att: st.pts3Att,
          ft_made: st.ftMade,
          ft_att: st.ftAttempted,
          reb_off: st.rebOff,
          reb_def: st.rebDef,
          assists: st.assists,
          steals: st.steals,
          turnovers: st.turnovers,
          blocks: st.blocks,
          blocks_against: st.blocksAgainst,
          fouls: st.fouls,
          fouls_drawn: st.foulsDrawn,
          playing_time_seconds: st.totalSecs
        };
      }),
      'stats_player_game_stats (totaux)'
    );
  }

  // Statistiques par joueuse ET par période (table dédiée stats_player_period_stats)
  const maxPeriod = Math.max(
    snap.game.period,
    ...snap.game.events.map(e => e.period),
    ...Object.values(snap.playingTime).flatMap(pt => Object.keys(pt).map(Number))
  );
  const periodRows: any[] = [];
  snap.game.matchRoster.forEach(p => {
    for (let per = 1; per <= maxPeriod; per++) {
      const st = statsOf(p.id, per);
      periodRows.push({
        match_id: matchId,
        player_id: p.id,
        player_number: p.number,
        player_name: p.name,
        period: per,
        is_starter: (snap.startingFiveByPeriod[per] || []).includes(p.id),
        playing_time_seconds: st.totalSecs,
        points: st.points,
        pts2_made: st.pts2Made,
        pts2_att: st.pts2Att,
        pts3_made: st.pts3Made,
        pts3_att: st.pts3Att,
        ft_made: st.ftMade,
        ft_att: st.ftAttempted,
        reb_off: st.rebOff,
        reb_def: st.rebDef,
        assists: st.assists,
        steals: st.steals,
        turnovers: st.turnovers,
        blocks: st.blocks,
        blocks_against: st.blocksAgainst,
        fouls: st.fouls,
        fouls_drawn: st.foulsDrawn
      });
    }
  });
  check(await supabase.from('stats_player_period_stats').delete().eq('match_id', matchId), 'stats_player_period_stats (suppression)');
  if (periodRows.length > 0) {
    await insertStatsRows('stats_player_period_stats', periodRows, 'stats_player_period_stats (insertion)');
  }

  return matchId;
}

type Role = 'admin' | 'analyst';

function TeamStatsApp({ userId, userEmail, role, onSignOut, needsReauth, onReauth }: { userId: string; userEmail: string; role: Role; onSignOut: () => void; needsReauth: boolean; onReauth: () => void }) {
  const isAdmin = role === 'admin';
  const [activeTab, setActiveTab] = useState<'INIT' | 'MATCH' | 'STATS' | 'LOGS'>('MATCH');
  const [selectedPeriodFilter, setSelectedPeriodFilter] = useState<number | 'ALL'>('ALL');

  const [savedTeams, setSavedTeams] = useState<SavedTeam[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [newTeamName, setNewTeamName] = useState('');
  const [editingRoster, setEditingRoster] = useState<Player[]>(DEFAULT_PLAYERS);
  const [newPlayerNumber, setNewPlayerNumber] = useState<number | ''>('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);

  const [matchConfig, setMatchConfig] = useState<GameConfig>({
    teamHome: '',
    teamAway: '',
    matchDate: new Date().toISOString().split('T')[0],
    periodCount: 4,
    periodMinutes: 10,
    ffbbMatchId: ''
  });

  const [selectedMatchPlayerIds, setSelectedMatchPlayerIds] = useState<string[]>([]);
  const [matchNumbers, setMatchNumbers] = useState<{ [playerId: string]: number }>({});

  const [game, setGame] = useState<GameState>({
    config: matchConfig,
    period: 1,
    clockSeconds: 600,
    isClockRunning: false,
    scoreHome: 0,
    scoreAway: 0,
    scoreByPeriod: {},
    matchRoster: [],
    onCourtPlayerIds: [],
    events: []
  });

  const [playingTime, setPlayingTime] = useState<{ [playerId: string]: { [period: number]: number } }>({});
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [ftAttempts, setFtAttempts] = useState<[boolean | null, boolean | null, boolean | null]>([null, null, null]);

  const [isSubbing, setIsSubbing] = useState(false);
  const [selectedOutIds, setSelectedOutIds] = useState<string[]>([]);
  const [selectedInIds, setSelectedInIds] = useState<string[]>([]);

  const [matchType, setMatchType] = useState<'OFFICIEL' | 'AMICAL'>('OFFICIEL');
  const [homeAway, setHomeAway] = useState<'DOMICILE' | 'EXTERIEUR'>('DOMICILE');
  const [isEditingTeamForm, setIsEditingTeamForm] = useState(false);
  const [showLogoFull, setShowLogoFull] = useState(false);
  const lastLogoTapRef = React.useRef(0);
  useEffect(() => {
    if (!showLogoFull) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowLogoFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLogoFull]);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [teamSaveStatus, setTeamSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [clubNames, setClubNames] = useState<string[]>([]);
  const [isLookingUpFfbb, setIsLookingUpFfbb] = useState(false);
  const [ffbbLookupStatus, setFfbbLookupStatus] = useState<'idle' | 'found' | 'notfound' | 'error'>('idle');
  const [ffbbLookupError, setFfbbLookupError] = useState('');
  const [showFfbbPicker, setShowFfbbPicker] = useState(false);
  const [existingMatches, setExistingMatches] = useState<any[]>([]);
  const [isLoadingExistingMatches, setIsLoadingExistingMatches] = useState(false);
  const [pickerTeamFilter, setPickerTeamFilter] = useState('ALL');
  const [pickerSeasonFilter, setPickerSeasonFilter] = useState('ALL');
  const [pickerStatusFilter, setPickerStatusFilter] = useState<'JOUE' | 'A_VENIR' | 'ALL'>('JOUE');
  const [upcomingMatches, setUpcomingMatches] = useState<any[]>([]);
  const [upcomingError, setUpcomingError] = useState('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [matchToDelete, setMatchToDelete] = useState<any | null>(null);
  const [isDeletingMatch, setIsDeletingMatch] = useState(false);
  const [actionToUndo, setActionToUndo] = useState<GameEvent | null>(null);
  const [currentMatchDbId, setCurrentMatchDbId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'queued' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const [isEditingClock, setIsEditingClock] = useState(false);
  const [confirmResetPeriod, setConfirmResetPeriod] = useState(false);
  const [startingFiveByPeriod, setStartingFiveByPeriod] = useState<{ [period: number]: string[] }>({});
  const [clockEditValue, setClockEditValue] = useState('');

  // --- Mode hors ligne
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [dataSyncedAt, setDataSyncedAt] = useState<number | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [pickerNotice, setPickerNotice] = useState('');
  const flushingRef = useRef(false);
  const draftReadyRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedFpRef = useRef('');
  const latestRef = useRef<any>(null);
  const draftKey = lsKey('draft', userId);

  // Notre équipe est toujours l'une de celles gérées dans stats_teams (sélectionnée
  // via "Charger une équipe Supabase" plus bas, qui renseigne matchConfig.teamHome).

  // CHARGEMENT DEPUIS SUPABASE (stats_teams + stats_players)
  const fetchTeamsFromSupabase = async () => {
    setIsLoadingTeams(true);
    try {
      const { data: teamsData, error } = await supabase
        .from('stats_teams')
        .select('id, name, stats_players(id, name, number)');

      if (error) {
        console.error("Erreur chargement Supabase:", error);
        // Hors connexion : on reprend les équipes et joueuses mises de côté lors de la dernière synchronisation.
        if (isNetworkError(error)) {
          const cached = lsRead<SavedTeam[] | null>(lsKey('teams', userId), null);
          if (cached) setSavedTeams(cached);
        }
      } else if (teamsData) {
        const formatted: SavedTeam[] = teamsData.map((t: any) => ({
          id: t.id,
          name: t.name,
          roster: sortPlayersAlpha((t.stats_players || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            number: p.number
          })))
        }));
        setSavedTeams(formatted);
        const now = Date.now();
        lsWrite(lsKey('teams', userId), formatted);
        lsWrite(lsKey('syncedAt', userId), now);
        setDataSyncedAt(now);
      }
    } catch (err) {
      console.error(err);
      if (isNetworkError(err)) {
        const cached = lsRead<SavedTeam[] | null>(lsKey('teams', userId), null);
        if (cached) setSavedTeams(cached);
      }
    } finally {
      setIsLoadingTeams(false);
    }
  };

  // Noms de clubs pour l'autocomplétion (mis en cache pour le hors ligne)
  const fetchClubNames = async () => {
    try {
      const { data, error } = await supabase.from('basketball_clubs').select('display_name').order('display_name');
      if (!error && data) {
        const names = Array.from(new Set(data.map((c: any) => c.display_name).filter(Boolean))) as string[];
        setClubNames(names);
        lsWrite(lsKey('clubs', userId), names);
      } else if (error && isNetworkError(error)) {
        setClubNames(lsRead<string[]>(lsKey('clubs', userId), []));
      }
    } catch (err) {
      console.error(err);
      if (isNetworkError(err)) setClubNames(lsRead<string[]>(lsKey('clubs', userId), []));
    }
  };

  // Matchs enregistrés + matchs à venir (liste du sélecteur), mis en cache pour le hors ligne.
  const fetchPickerData = async () => {
    let offline = false;
    try {
      const [playedRes, upcomingRes] = await Promise.all([
        supabase
          .from('stats_matches')
          .select('id, ffbb_match_id, team_home, team_away, match_date, score_home, score_away, period_count, period_minutes, current_period, current_timer, created_at')
          .order('match_date', { ascending: false })
          .limit(200),
        // Calendrier des matchs à venir tenu dans l'appli principale (voir sql/ffbb_upcoming.sql).
        supabase.rpc('list_upcoming_ffbb_matches')
      ]);
      if (!playedRes.error && playedRes.data) {
        setExistingMatches(playedRes.data);
        lsWrite(lsKey('played', userId), playedRes.data);
      } else if (playedRes.error && isNetworkError(playedRes.error)) {
        offline = true;
      }
      if (upcomingRes.error) {
        if (isNetworkError(upcomingRes.error)) {
          offline = true;
        } else {
          setUpcomingMatches([]);
          setUpcomingError(upcomingRes.error.message);
        }
      } else {
        const rows = Array.isArray(upcomingRes.data) ? upcomingRes.data : [];
        setUpcomingMatches(rows);
        setUpcomingError('');
        lsWrite(lsKey('upcoming', userId), rows);
      }
    } catch (err) {
      console.error(err);
      offline = isNetworkError(err);
    }
    if (offline) {
      setExistingMatches(lsRead<any[]>(lsKey('played', userId), []));
      setUpcomingMatches(lsRead<any[]>(lsKey('upcoming', userId), []));
      setUpcomingError('');
    }
  };

  // SYNCHRONISER : récupère équipes, joueuses, matchs à venir et clubs (et les garde pour le hors ligne).
  // Hors connexion, chaque lecture retombe toute seule sur la dernière copie locale.
  const syncOfflineData = async () => {
    await Promise.all([fetchTeamsFromSupabase(), fetchPickerData(), fetchClubNames()]);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      // Précharge le module PDF pour que l'export des statistiques marche aussi sans réseau.
      void import('jspdf').catch(() => undefined);
      void import('jspdf-autotable').catch(() => undefined);
    }
  };

  useEffect(() => {
    const cachedAt = lsRead<number | null>(lsKey('syncedAt', userId), null);
    if (cachedAt) setDataSyncedAt(cachedAt);
    void syncOfflineData();
  }, []);

  // RECHERCHE DES INFOS D'UN MATCH OFFICIEL VIA L'ID FFBB
  const fetchFfbbMatchInfo = async (ffbbId: string) => {
    if (!ffbbId.trim()) { setFfbbLookupStatus('idle'); return; }
    setIsLookingUpFfbb(true);
    setFfbbLookupError('');
    try {
      // Fonction SQL dédiée (voir sql/ffbb_lookup.sql) : contourne la RLS de basketball_matches
      // tout en ne renvoyant que les colonnes utiles pour un ID exact.
      const { data, error } = await supabase.rpc('lookup_ffbb_match', { p_ffbb_id: ffbbId.trim() });
      const row: any = Array.isArray(data) ? data[0] : data;

      if (error) {
        setFfbbLookupError(isNetworkError(error) ? 'Hors connexion : choisissez le match dans la liste « À VENIR » (loupe).' : error.message);
        setFfbbLookupStatus('error');
      } else if (!row) {
        setFfbbLookupStatus('notfound');
      } else {
        setMatchConfig(prev => ({
          ...prev,
          teamAway: row.opponent || prev.teamAway,
          matchDate: row.match_date ? String(row.match_date).slice(0, 10) : prev.matchDate
        }));
        setFfbbLookupStatus('found');
      }
    } catch (err: any) {
      setFfbbLookupError(err?.message || String(err));
      setFfbbLookupStatus('error');
    } finally {
      setIsLookingUpFfbb(false);
    }
  };

  // Saison sportive : du 01/09 au 31/08 (ex: un match du 27/09/2026 -> saison "2026-2027")
  const getSeasonLabel = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = d.getMonth(); // 0 = janvier ... 8 = septembre
    return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  };

  // OUVRIR LE SÉLECTEUR DES MATCHS DÉJÀ ENREGISTRÉS (stats_matches)
  const openFfbbPicker = async () => {
    setShowFfbbPicker(true);
    setIsLoadingExistingMatches(true);
    setPickerNotice('');
    setPickerSeasonFilter(getSeasonLabel(new Date().toISOString().split('T')[0]));
    try {
      await fetchPickerData();
    } finally {
      setIsLoadingExistingMatches(false);
    }
  };

  // Notre équipe (stats_teams) correspondant à un match du calendrier : même catégorie (U15F...),
  // en préférant l'équipe dont le nom porte la saison du match (ex. "2026/2027").
  const findOurTeamForUpcoming = (u: any) => {
    const labels = [u.category, u.our_team_name, u.division_label];
    const candidates = savedTeams.filter(t => sameCategory(t.name, labels));
    if (candidates.length <= 1) return candidates[0];
    const season = getSeasonLabel(u.match_date);
    return candidates.find(t => t.name.includes(season) || t.name.includes(season.replace('-', '/'))) || candidates[0];
  };

  // PRÉ-REMPLIR UN NOUVEAU MATCH DEPUIS UN MATCH DU CALENDRIER (à venir)
  const handleSelectUpcomingMatch = (u: any) => {
    const team = findOurTeamForUpcoming(u);
    if (team) handleLoadTeamFromSelect(team.id);
    setHomeAway(String(u.home_away || '').toLowerCase().startsWith('ext') ? 'EXTERIEUR' : 'DOMICILE');
    setMatchType('OFFICIEL');
    setMatchConfig(prev => ({
      ...prev,
      teamAway: u.opponent || prev.teamAway,
      matchDate: u.match_date ? new Date(u.match_date).toLocaleDateString('sv-SE') : prev.matchDate,
      ffbbMatchId: String(u.ffbb_rencontre_id || '').slice(0, 20)
    }));
    setFfbbLookupStatus('found');
    // On reste sur l'écran de configuration : le formulaire du match est prérempli, il suffit de le vérifier.
    setShowFfbbPicker(false);
  };

  // SUPPRIMER DÉFINITIVEMENT UN MATCH (infos + événements + statistiques)
  // Le match supprimé est-il celui affiché à l'écran (même enregistrement, ou même numéro de match) ?
  const isDisplayedMatch = (m: any) =>
    !!m && (currentMatchDbId === m.id || (!!matchConfig.ffbbMatchId.trim() && matchConfig.ffbbMatchId.trim() === String(m.ffbb_match_id || '')));

  const handleDeleteMatch = async () => {
    if (!matchToDelete) return;
    setIsDeletingMatch(true);
    setPickerNotice('');
    try {
      // Les statistiques par période référencent le match : elles doivent partir en premier, sinon la suppression est refusée.
      for (const table of ['stats_match_events', 'stats_player_game_stats', 'stats_player_period_stats']) {
        const { error } = await supabase.from(table).delete().eq('match_id', matchToDelete.id);
        if (error) throw new Error(`${table} : ${error.message}`);
      }
      const { error: matchError } = await supabase.from('stats_matches').delete().eq('id', matchToDelete.id);
      if (matchError) throw new Error(`stats_matches : ${matchError.message}`);

      setExistingMatches(prev => prev.filter(m => m.id !== matchToDelete.id));
      // Un envoi en attente de ce match ne doit pas le recréer plus tard.
      removePending(userId, String(matchToDelete.ffbb_match_id || ''));
      refreshPending();
      // Si c'est le match affiché, l'écran est remis à zéro aussi (actions, score, temps de jeu, chrono).
      if (isDisplayedMatch(matchToDelete)) resetMatchLocally(false);
    } catch (err: any) {
      console.error(err);
      setPickerNotice(isNetworkError(err)
        ? "Hors connexion : la suppression est impossible maintenant. Réessayez quand le réseau est revenu."
        : `Suppression impossible : ${err?.message || err}`);
    } finally {
      setIsDeletingMatch(false);
      setMatchToDelete(null);
    }
  };

  // REMISE À ZÉRO du match affiché : actions, score (global et par période), temps de jeu de toutes les joueuses,
  // chrono, période et cinq de départ. L'équipe, l'adversaire, la date et la feuille de match sont conservés.
  const resetMatchLocally = (keepDbId: boolean) => {
    const starters = startingFiveByPeriod[1] && startingFiveByPeriod[1].length > 0 ? startingFiveByPeriod[1] : game.onCourtPlayerIds;
    setGame(prev => ({
      ...prev,
      period: 1,
      clockSeconds: prev.config.periodMinutes * 60,
      isClockRunning: false,
      scoreHome: 0,
      scoreAway: 0,
      scoreByPeriod: {},
      onCourtPlayerIds: starters,
      events: []
    }));
    setPlayingTime({});
    setStartingFiveByPeriod({ 1: starters });
    setSelectedPlayerId(null);
    setIsSubbing(false);
    setSelectedOutIds([]);
    setSelectedInIds([]);
    setConfirmResetPeriod(false);
    setSelectedPeriodFilter('ALL');
    if (!keepDbId) setCurrentMatchDbId(null);
    lastSavedFpRef.current = '';
  };

  const handleResetAll = () => {
    const ok = window.confirm(
      "Tout remettre à zéro ?\n\nLes actions, le score, les temps de jeu et le chrono de CE match seront effacés de l'écran. "
      + "Un envoi en attente pour ce match sera annulé. Ce qui est déjà enregistré en base n'est modifié que si vous enregistrez ensuite."
    );
    if (!ok) return;
    resetMatchLocally(true);
    const ffbbId = matchConfig.ffbbMatchId.trim();
    if (ffbbId) removePending(userId, ffbbId);
    refreshPending();
  };

  // CHARGER UN MATCH EXISTANT (infos + statistiques) DEPUIS SUPABASE
  const handleSelectExistingMatch = async (matchRow: any) => {
    setPickerNotice('');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPickerNotice("Hors connexion : ce match enregistré ne peut pas être rouvert maintenant. Réessayez quand le réseau est revenu.");
      return;
    }
    try {
      const { data: eventsData, error: eventsError } = await supabase
        .from('stats_match_events')
        .select('*')
        .eq('match_id', matchRow.id)
        .order('created_at', { ascending: true });

      const { data: statsData, error: statsError } = await supabase
        .from('stats_player_game_stats')
        .select('*')
        .eq('match_id', matchRow.id);

      // Ne jamais remplacer le match affiché par un chargement incomplet.
      if (eventsError || statsError) throw new Error((eventsError || statsError)?.message || 'Lecture impossible');

      const loadedRoster: Player[] = (statsData || []).map((s: any) => ({
        id: s.player_id,
        number: s.player_number || 0,
        name: s.player_name || '?'
      }));

      const onCourtMarkers = (eventsData || []).filter((e: any) => e.action_type === 'ETAT:SUR_TERRAIN');
      const loadedOnCourtIds = onCourtMarkers.map((e: any) => e.player_id).filter((id: string) => loadedRoster.some(p => p.id === id));

      const { data: periodData } = await supabase
        .from('stats_player_period_stats')
        .select('player_id, period, is_starter, playing_time_seconds')
        .eq('match_id', matchRow.id);

      const loadedStartingFiveByPeriod: { [period: number]: string[] } = {};
      const newPlayingTime: { [playerId: string]: { [period: number]: number } } = {};
      (periodData || []).forEach((r: any) => {
        if (r.is_starter) {
          if (!loadedStartingFiveByPeriod[r.period]) loadedStartingFiveByPeriod[r.period] = [];
          loadedStartingFiveByPeriod[r.period].push(r.player_id);
        }
        if (!newPlayingTime[r.player_id]) newPlayingTime[r.player_id] = {};
        newPlayingTime[r.player_id][r.period] = r.playing_time_seconds || 0;
      });
      // Repli pour un match sans détail par période : total placé dans un compteur "période 0".
      (statsData || []).forEach((s: any) => {
        if (!newPlayingTime[s.player_id]) newPlayingTime[s.player_id] = { 0: s.playing_time_seconds || 0 };
      });

      const loadedEvents: GameEvent[] = (eventsData || [])
        .filter((e: any) => !String(e.action_type).startsWith('ETAT:'))
        .map((e: any) => ({
          id: e.id,
          timestamp: e.timestamp_str || '',
          period: e.period,
          clockTime: e.clock_time,
          actionType: e.action_type,
          playerId: e.player_id
        })).reverse();

      // Score par période, reconstruit depuis les marqueurs "ETAT:SCORE_PERIODE:home-away"
      const loadedScoreByPeriod: { [period: number]: { home: number; away: number } } = {};
      (eventsData || [])
        .filter((e: any) => String(e.action_type).startsWith('ETAT:SCORE_PERIODE:'))
        .forEach((e: any) => {
          const [h, a] = String(e.action_type).split(':')[2].split('-').map((v: string) => parseInt(v, 10) || 0);
          loadedScoreByPeriod[e.period] = { home: h, away: a };
        });

      // Notre équipe est celle qui figure dans stats_teams : on en déduit DOM ou EXT.
      const ourTeamNames = savedTeams.map(t => t.name);
      const weAreAway = !ourTeamNames.includes(matchRow.team_home) && ourTeamNames.includes(matchRow.team_away);
      setHomeAway(weAreAway ? 'EXTERIEUR' : 'DOMICILE');

      const newConfig: GameConfig = {
        teamHome: weAreAway ? matchRow.team_away : matchRow.team_home,
        teamAway: weAreAway ? matchRow.team_home : matchRow.team_away,
        matchDate: matchRow.match_date || new Date().toISOString().split('T')[0],
        periodCount: matchRow.period_count || 4,
        periodMinutes: matchRow.period_minutes || 10,
        ffbbMatchId: matchRow.ffbb_match_id || ''
      };

      setMatchConfig(newConfig);
      setPlayingTime(newPlayingTime);
      setCurrentMatchDbId(matchRow.id);
      setMatchType(String(matchRow.ffbb_match_id || '').startsWith('AMICAL-') ? 'AMICAL' : 'OFFICIEL');
      setStartingFiveByPeriod(loadedStartingFiveByPeriod);

      setGame({
        config: newConfig,
        period: (() => {
          const label = String(matchRow.current_period || 'Q1');
          const n = parseInt(label.replace(/\D/g, ''), 10) || 1;
          // "OT1" = première prolongation = période (nombre de périodes + 1)
          return /^OT/i.test(label) ? (matchRow.period_count || 4) + n : n;
        })(),
        clockSeconds: matchRow.current_timer ?? matchRow.period_minutes * 60,
        isClockRunning: false,
        scoreHome: (weAreAway ? matchRow.score_away : matchRow.score_home) || 0,
        scoreAway: (weAreAway ? matchRow.score_home : matchRow.score_away) || 0,
        scoreByPeriod: Object.fromEntries(
          Object.entries(loadedScoreByPeriod).map(([p, s]) => [p, weAreAway ? { home: s.away, away: s.home } : s])
        ),
        matchRoster: loadedRoster,
        onCourtPlayerIds: loadedOnCourtIds.length > 0 ? loadedOnCourtIds : loadedRoster.slice(0, 5).map(p => p.id),
        events: loadedEvents
      });

      setShowFfbbPicker(false);
      setActiveTab('MATCH');
    } catch (err: any) {
      console.error(err);
      setPickerNotice(isNetworkError(err)
        ? "Hors connexion : ce match enregistré ne peut pas être rouvert maintenant. Réessayez quand le réseau est revenu."
        : `Impossible de charger ce match : ${err?.message || err}`);
    }
  };

  // ---------------------------------------------------------------------------
  // ENREGISTRER LE MATCH EN COURS
  // En ligne : directement en base. Hors ligne (ou réseau défaillant) : sur l'appareil, puis envoi
  // automatique au retour du réseau. Chaque enregistrement réécrit tout le match : on peut donc
  // enregistrer plusieurs fois, et un envoi interrompu se rejoue sans risque.
  // ---------------------------------------------------------------------------
  const refreshPending = () => setPendingCount(readPending().filter(i => i.userId === userId).length);

  const writeDraftNow = () => {
    if (!draftReadyRef.current || !latestRef.current) return;
    const L = latestRef.current;
    lsWrite(draftKey, { v: 1, userId, savedAt: Date.now(), savedFp: lastSavedFpRef.current, ...L, game: { ...L.game, isClockRunning: false } });
  };

  const buildSnapshot = (ffbbId: string): MatchSnapshot => ({
    ffbbId,
    matchConfig: { ...matchConfig, ffbbMatchId: ffbbId },
    homeAway,
    game: JSON.parse(JSON.stringify(game)),
    playingTime: JSON.parse(JSON.stringify(playingTime)),
    startingFiveByPeriod: JSON.parse(JSON.stringify(startingFiveByPeriod)),
    savedAt: Date.now()
  });

  const handleSaveMatch = async () => {
    if (saveStatus === 'saving') return;
    setSaveStatus('saving');
    setSaveErrorMessage('');

    let ffbbId = matchConfig.ffbbMatchId.trim();
    if (!ffbbId) {
      ffbbId = `AMICAL-${Date.now()}`;
      setMatchConfig(prev => ({ ...prev, ffbbMatchId: ffbbId }));
    }
    const snap = buildSnapshot(ffbbId);
    const fp = fingerprintOf(snap.game);

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Failed to fetch (hors connexion)');
      const matchId = await persistMatchSnapshot(snap);
      setCurrentMatchDbId(matchId);
      removePending(userId, ffbbId); // l'enregistrement en ligne remplace un envoi en attente pour ce match
      refreshPending();
      lastSavedFpRef.current = fp;
      writeDraftNow();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err: any) {
      console.error(err);
      if (isNetworkError(err)) {
        if (enqueuePending(userId, snap)) {
          lastSavedFpRef.current = fp;
          refreshPending();
          writeDraftNow();
          setSaveStatus('queued');
          setTimeout(() => setSaveStatus('idle'), 6000);
        } else {
          setSaveErrorMessage("Hors connexion, et la mémoire de l'appareil est pleine : le match n'a pas pu être mis de côté.");
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 15000);
        }
      } else {
        setSaveErrorMessage(err?.message || String(err));
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 15000);
      }
    }
  };

  // Envoie les matchs mis de côté hors ligne (un à un, du plus ancien au plus récent).
  const flushPending = async (manual = false) => {
    if (flushingRef.current) return;
    const items = readPending().filter(i => i.userId === userId);
    if (items.length === 0) {
      if (manual) setSyncMessage('Rien à envoyer.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (manual) setSyncMessage('Toujours hors connexion : envoi dès que le réseau revient.');
      return;
    }
    flushingRef.current = true;
    setIsSyncing(true);
    let sent = 0;
    let failure = '';
    try {
      for (const item of items) {
        try {
          const matchId = await persistMatchSnapshot(item.snap);
          removePending(userId, item.snap.ffbbId, item.snap.savedAt); // garde une version plus récente si elle existe
          sent++;
          if (latestRef.current?.matchConfig?.ffbbMatchId === item.snap.ffbbId) setCurrentMatchDbId(matchId);
        } catch (err: any) {
          if (isNetworkError(err)) { failure = 'Réseau instable : nouvel essai automatique.'; break; }
          failure = `Envoi refusé : ${err?.message || err}`;
        }
      }
    } finally {
      flushingRef.current = false;
      setIsSyncing(false);
      refreshPending();
      setSyncMessage(sent > 0 ? `${sent} match${sent > 1 ? 's envoyés' : ' envoyé'} en base.${failure ? ' ' + failure : ''}` : failure);
      if (sent > 0 || failure) setTimeout(() => setSyncMessage(''), 8000);
    }
  };

  // Nouveau match : efface le brouillon local et repart d'un écran vide (les envois en attente sont conservés).
  const handleNewMatch = () => {
    const unsaved = game.events.length > 0 && fingerprintOf(game) !== lastSavedFpRef.current;
    const message = unsaved
      ? "Des actions de ce match ne sont pas encore enregistrées. Un nouveau match les effacera de cet écran. Continuer ?"
      : "Démarrer un nouveau match ? Le match affiché sera fermé (ce qui est enregistré est conservé).";
    if (!window.confirm(message)) return;
    lsRemove(draftKey);
    window.location.reload();
  };

  // Brouillon : l'état du match est gardé sur l'appareil, il survit à un rechargement ou à une fermeture de la page.
  latestRef.current = { matchConfig, homeAway, matchType, selectedTeamId, newTeamName, editingRoster, selectedMatchPlayerIds, matchNumbers, game, playingTime, startingFiveByPeriod, currentMatchDbId, activeTab };

  useEffect(() => {
    const d = lsRead<any>(draftKey, null);
    if (d && d.v === 1 && d.userId === userId && Date.now() - d.savedAt < 48 * 3600 * 1000 && d.game && d.matchConfig) {
      setMatchConfig(d.matchConfig);
      setHomeAway(d.homeAway);
      setMatchType(d.matchType);
      setSelectedTeamId(d.selectedTeamId || '');
      setNewTeamName(d.newTeamName || '');
      setEditingRoster(d.editingRoster || []);
      setSelectedMatchPlayerIds(d.selectedMatchPlayerIds || []);
      setMatchNumbers(d.matchNumbers || {});
      setGame({ ...d.game, isClockRunning: false });
      setPlayingTime(d.playingTime || {});
      setStartingFiveByPeriod(d.startingFiveByPeriod || {});
      setCurrentMatchDbId(d.currentMatchDbId || null);
      if (d.activeTab) setActiveTab(d.activeTab);
      lastSavedFpRef.current = d.savedFp || '';
      if (d.game.events?.length > 0 || d.game.matchRoster?.length > 0) setRestoredAt(d.savedAt);
    }
    draftReadyRef.current = true;
  }, []);

  // Écriture du brouillon : au plus une fois toutes les 1,5 s (le chrono modifie l'état chaque seconde).
  useEffect(() => {
    if (!draftReadyRef.current || draftTimerRef.current) return;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      writeDraftNow();
    }, 1500);
  });

  // Réseau : état en ligne / hors ligne, envoi automatique au retour du réseau, nouvel essai toutes les 30 s.
  useEffect(() => {
    refreshPending();
    setIsOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const handleOnline = () => {
      setIsOnline(true);
      void flushPending();
      void syncOfflineData();
    };
    const handleOffline = () => setIsOnline(false);
    const handleHide = () => { if (document.visibilityState === 'hidden') writeDraftNow(); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleHide);
    window.addEventListener('pagehide', writeDraftNow);
    const timer = setInterval(() => {
      if (navigator.onLine && readPending().some(i => i.userId === userId)) void flushPending();
    }, 30000);
    if (navigator.onLine) void flushPending();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleHide);
      window.removeEventListener('pagehide', writeDraftNow);
      clearInterval(timer);
    };
  }, []);

  // SAUVEGARDE / MODIFICATION DANS SUPABASE
  const handleSaveTeamToSupabase = async () => {
    if (!newTeamName.trim()) return;
    setTeamSaveStatus('saving');

    try {
      let targetTeamId = selectedTeamId;

      if (!targetTeamId && !isAdmin) {
        // Seul l'admin crée des équipes (l'analyste modifie celles qui lui sont ouvertes).
        setTeamSaveStatus('error');
        return;
      }

      if (targetTeamId) {
        // UPDATE ÉQUIPE
        await supabase
          .from('stats_teams')
          .update({ name: newTeamName.trim() })
          .eq('id', targetTeamId);
      } else {
        // INSERT NOUVELLE ÉQUIPE
        const { data: createdTeam, error: teamErr } = await supabase
          .from('stats_teams')
          .insert({ name: newTeamName.trim() })
          .select()
          .single();

        if (teamErr || !createdTeam) throw teamErr;
        targetTeamId = createdTeam.id;
      }

      // On récupère les joueuses déjà en base pour cette équipe, pour fusionner par NOM
      // (clé Équipe/Nom) plutôt que par numéro ou par id local, ce qui évite les doublons
      // si "Enregistrer" est cliqué plusieurs fois de suite.
      const { data: existingPlayers } = await supabase
        .from('stats_players')
        .select('id, name')
        .eq('team_id', targetTeamId);

      for (const player of editingRoster) {
        const match = (existingPlayers || []).find(
          (ep: any) => ep.name.trim().toUpperCase() === player.name.trim().toUpperCase()
        );
        if (match) {
          await supabase.from('stats_players').update({ number: player.number }).eq('id', match.id);
        } else {
          await supabase.from('stats_players').insert({ team_id: targetTeamId, name: player.name, number: player.number });
        }
      }

      // Les joueuses retirées localement (bouton 🗑️) sont aussi supprimées en base.
      const currentNames = editingRoster.map(p => p.name.trim().toUpperCase());
      const removedPlayers = (existingPlayers || []).filter(
        (ep: any) => !currentNames.includes(ep.name.trim().toUpperCase())
      );
      for (const removed of removedPlayers) {
        await supabase.from('stats_players').delete().eq('id', removed.id);
      }

      setTeamSaveStatus('saved');
      setTimeout(() => setTeamSaveStatus('idle'), 2000);
      setNewTeamName('');
      setSelectedTeamId('');
      setIsEditingTeamForm(false);
      setEditingPlayerId(null);
      await fetchTeamsFromSupabase();
    } catch (err: any) {
      console.error(err);
      setTeamSaveStatus('error');
      setTimeout(() => setTeamSaveStatus('idle'), 3000);
    }
  };

  useEffect(() => {
    let timer: any;
    if (game.isClockRunning && game.clockSeconds > 0) {
      timer = setInterval(() => {
        setGame(prev => ({ ...prev, clockSeconds: prev.clockSeconds - 1 }));
        setPlayingTime(prev => {
          const updated = { ...prev };
          game.onCourtPlayerIds.forEach(id => {
            if (!updated[id]) updated[id] = {};
            updated[id][game.period] = (updated[id][game.period] || 0) + 1;
          });
          return updated;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [game.isClockRunning, game.clockSeconds, game.onCourtPlayerIds, game.period]);

  const getPeriodLabel = (pNum: number, totalPeriods: number) => {
    if (pNum > totalPeriods) return `OT${pNum - totalPeriods}`;
    return totalPeriods === 4 ? `Q${pNum}` : `P${pNum}`;
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Affichage allégé "PRENOM" (+ initiale(s) du nom si une autre joueuse partage le même prénom)
  const getShortDisplayName = (player: { name: string; id: string }, pool: { id: string; name: string }[]) => {
    const parts = player.name.trim().split(/\s+/);
    const firstName = parts[0] || player.name;
    const lastName = parts.slice(1).join(' ');
    if (!lastName) return firstName;

    const homonyms = pool.filter(p => {
      if (p.id === player.id) return false;
      const pFirst = p.name.trim().split(/\s+/)[0] || p.name;
      return pFirst.toUpperCase() === firstName.toUpperCase();
    });
    if (homonyms.length === 0) return firstName;

    const myLast = lastName.toUpperCase();
    const otherLasts = homonyms.map(p => (p.name.trim().split(/\s+/).slice(1).join(' ') || '').toUpperCase());
    let prefixLen = 1;
    while (prefixLen < myLast.length && otherLasts.some(ln => ln.slice(0, prefixLen) === myLast.slice(0, prefixLen))) {
      prefixLen++;
    }
    return `${firstName} ${myLast.slice(0, prefixLen)}.`;
  };

  const startEditingClock = () => {
    setClockEditValue(formatTime(game.clockSeconds));
    setIsEditingClock(true);
  };

  const commitClockEdit = () => {
    const match = clockEditValue.trim().match(/^(\d{1,2}):?(\d{0,2})$/);
    if (match) {
      const m = parseInt(match[1] || '0', 10);
      const s = parseInt(match[2] || '0', 10);
      const totalSecs = Math.max(0, m * 60 + Math.min(59, s));
      setGame(prev => ({ ...prev, clockSeconds: totalSecs, isClockRunning: false }));
    }
    setIsEditingClock(false);
  };

  // Changer de période : mémorise le 5 sur le terrain comme "5 de départ" de cette période
  // (une seule fois, la première fois que la période est atteinte). Stocké en base dans la
  // table par joueuse et par période (colonne is_starter), jamais affiché à l'écran.
  // Prolongation possible : U13 et +, fin de match (dernière période ou prolongation en cours) et égalité.
  const overtimeAllowed = categoryAllowsOvertime(matchConfig.teamHome);
  const isTied = game.scoreHome === game.scoreAway;
  const atLastPeriod = game.period >= game.config.periodCount;
  const canStartOvertime = overtimeAllowed && isTied && atLastPeriod;

  const changePeriod = (newPeriod: number) => {
    const target = Math.max(1, newPeriod);
    const goesBeyondRegular = target > game.period && target > game.config.periodCount;
    // Au-delà du temps réglementaire : une prolongation à la fois, seulement si autorisée et à égalité.
    if (goesBeyondRegular && !(canStartOvertime && target === game.period + 1)) return;
    // Passer du temps réglementaire aux prolongations (ou l'inverse, ex. OT1 -> Q4) remet le chrono
    // à la durée de ce type de période : 5 min en prolongation, durée normale sinon.
    const willBeOvertime = target > game.config.periodCount;
    const crossesBoundary = (game.period > game.config.periodCount) !== willBeOvertime;
    setStartingFiveByPeriod(sf => (sf[target] ? sf : { ...sf, [target]: game.onCourtPlayerIds }));
    setGame(prev => ({
      ...prev,
      period: target,
      ...(crossesBoundary
        ? { clockSeconds: (willBeOvertime ? OVERTIME_MINUTES : prev.config.periodMinutes) * 60, isClockRunning: false }
        : {})
    }));
  };

  // RÉINITIALISER LE QUART-TEMPS EN COURS : remet le chrono à fond et efface le temps de jeu
  // + les actions déjà enregistrées pour cette période précise .
  const handleConfirmResetPeriod = () => {
    const p = game.period;
    setGame(prev => {
      // Le score de la période (le nôtre et celui de l'adversaire, tenus période par période) est retiré :
      // on revient au score de la fin de la période précédente (0-0 pour la première).
      const fallbackHome = prev.events.filter(e => e.period === p).reduce((sum, e) => sum + pointsOfAction(e.actionType), 0);
      const removed = prev.scoreByPeriod[p] ?? { home: fallbackHome, away: 0 };
      return {
        ...prev,
        clockSeconds: (p > prev.config.periodCount ? OVERTIME_MINUTES : prev.config.periodMinutes) * 60,
        isClockRunning: false,
        events: prev.events.filter(e => e.period !== p),
        scoreHome: Math.max(0, prev.scoreHome - removed.home),
        scoreAway: Math.max(0, prev.scoreAway - removed.away),
        scoreByPeriod: { ...prev.scoreByPeriod, [p]: { home: 0, away: 0 } }
      };
    });
    setPlayingTime(prev => {
      const updated: { [playerId: string]: { [period: number]: number } } = {};
      Object.keys(prev).forEach(pid => {
        const periods = { ...prev[pid] };
        delete periods[p];
        updated[pid] = periods;
      });
      return updated;
    });
    setConfirmResetPeriod(false);
  };

  const getFoulsCount = (playerId: string) => {
    const playerFouls = game.events.filter(e => e.playerId === playerId && e.actionType.includes('FAUTE') && !e.actionType.includes('SUBIE'));
    if (playerFouls.some(e => e.actionType.includes('DISQUALIFIANTE'))) return 5;
    // Règle FIBA : deux fautes antisportives = disqualification.
    if (playerFouls.filter(e => e.actionType.includes('ANTISPORTIVE')).length >= 2) return 5;
    return playerFouls.length;
  };

  // Fautes commises par notre équipe pendant la période
  const getTeamFoulsForPeriod = (pNum: number) => {
    return game.events.filter(e => e.period === pNum && e.actionType.includes('FAUTE') && !e.actionType.includes('SUBIE')).length;
  };

  // Fautes commises par l'équipe adverse pendant la période (= Fautes SUBIES par notre équipe)
  const getOpponentFoulsForPeriod = (pNum: number) => {
    return game.events.filter(e => e.period === pNum && e.actionType.includes('FAUTE SUBIE')).length;
  };

  const availableBenchPlayers = game.matchRoster.filter(
    p => !game.onCourtPlayerIds.includes(p.id) && getFoulsCount(p.id) < 5
  );

  // Ajustement manuel du score (+/-) : garde le score par période synchronisé
  const bumpScore = (side: 'home' | 'away', delta: number) => {
    setGame(prev => {
      const per = prev.scoreByPeriod[prev.period] || { home: 0, away: 0 };
      return {
        ...prev,
        scoreHome: side === 'home' ? Math.max(0, prev.scoreHome + delta) : prev.scoreHome,
        scoreAway: side === 'away' ? Math.max(0, prev.scoreAway + delta) : prev.scoreAway,
        scoreByPeriod: { ...prev.scoreByPeriod, [prev.period]: { ...per, [side]: Math.max(0, per[side] + delta) } }
      };
    });
  };

  const recordEvent = (action: string, playerId: string, points = 0) => {
    if (!playerId) return;
    const newEvent: GameEvent = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      period: game.period,
      clockTime: formatTime(game.clockSeconds),
      actionType: action,
      playerId: playerId
    };

    let updatedOnCourt = [...game.onCourtPlayerIds];
    let alertFoul = false;

    const previousUnsportsmanlike = game.events.filter(e => e.playerId === playerId && e.actionType.includes('ANTISPORTIVE')).length;
    if (action.includes('DISQUALIFIANTE') || (action.includes('ANTISPORTIVE') && previousUnsportsmanlike + 1 >= 2)) {
      updatedOnCourt = updatedOnCourt.filter(id => id !== playerId);
      alertFoul = true;
    } else if (action.includes('FAUTE') && !action.includes('SUBIE')) {
      const currentFouls = getFoulsCount(playerId) + 1;
      if (currentFouls >= 5) {
        updatedOnCourt = updatedOnCourt.filter(id => id !== playerId);
        alertFoul = true;
      }
    }

    setGame(prev => {
      const per = prev.scoreByPeriod[prev.period] || { home: 0, away: 0 };
      return {
        ...prev,
        scoreHome: prev.scoreHome + points,
        scoreByPeriod: points !== 0 ? { ...prev.scoreByPeriod, [prev.period]: { ...per, home: per.home + points } } : prev.scoreByPeriod,
        onCourtPlayerIds: updatedOnCourt,
        events: [newEvent, ...prev.events]
      };
    });

    setSelectedPlayerId(null);
    setFtAttempts([null, null, null]);

    if (alertFoul) {
      setSelectedOutIds([playerId]);
      setIsSubbing(true);
    }
  };

  // Dernière action réelle (hors remplacements/marqueurs internes) enregistrée pour une joueuse
  const getLastPlayerAction = (playerId: string) => {
    return game.events.find(e => e.playerId === playerId && !e.actionType.startsWith('REMPLACEMENT') && !e.actionType.startsWith('ETAT:')) || null;
  };

  // ANNULER (supprimer) la dernière action confirmée
  const handleConfirmUndo = () => {
    if (!actionToUndo) return;
    deleteEvent(actionToUndo.id);
    setActionToUndo(null);
  };

  const handleFreeThrowsSubmit = () => {
    if (!selectedPlayerId) return;
    let points = 0;
    const details: string[] = [];

    ftAttempts.forEach((res, index) => {
      if (res === true) {
        points += 1;
        details.push(`LF${index + 1}: Réussi`);
      } else if (res === false) {
        details.push(`LF${index + 1}: Manqué`);
      }
    });

    if (details.length === 0) return;
    recordEvent(`LANCERS FRANCS (${points}/${details.length})`, selectedPlayerId, points);
  };

  const toggleSelectOut = (id: string) => {
    if (getFoulsCount(id) >= 5) return;
    setSelectedOutIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectIn = (id: string) => {
    if (getFoulsCount(id) >= 5) return;
    if (selectedInIds.includes(id)) {
      setSelectedInIds(selectedInIds.filter(i => i !== id));
    } else if (selectedInIds.length < selectedOutIds.length) {
      setSelectedInIds([...selectedInIds, id]);
    }
  };

  const validateSubstitutions = () => {
    if (selectedOutIds.length !== selectedInIds.length || selectedOutIds.length === 0) return;

    const matchNotStarted = game.period === 1 && game.clockSeconds === game.config.periodMinutes * 60 && game.events.length === 0;

    setGame(prev => {
      const updatedOnCourt = [
        ...prev.onCourtPlayerIds.filter(id => !selectedOutIds.includes(id)),
        ...selectedInIds
      ];

      if (matchNotStarted) {
        return { ...prev, onCourtPlayerIds: updatedOnCourt };
      }

      const pOutNames = selectedOutIds.map(id => "#" + prev.matchRoster.find(p => p.id === id)?.number).join(', ');
      const pInNames = selectedInIds.map(id => "#" + prev.matchRoster.find(p => p.id === id)?.number).join(', ');

      const subEvent: GameEvent = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString(),
        period: prev.period,
        clockTime: formatTime(prev.clockSeconds),
        actionType: `REMPLACEMENT (${selectedOutIds.length}j) - Out: ${pOutNames} / In: ${pInNames}`,
        playerId: selectedInIds[0]
      };

      return { ...prev, onCourtPlayerIds: updatedOnCourt, events: [subEvent, ...prev.events] };
    });

    setIsSubbing(false);
    setSelectedOutIds([]);
    setSelectedInIds([]);
  };

  const deleteEvent = (eventId: string) => {
    const eventToDelete = game.events.find(ev => ev.id === eventId);
    if (!eventToDelete) return;

    let pointsToRemove = 0;
    if (eventToDelete.actionType.includes('TIR 3PTS') && !eventToDelete.actionType.includes('Manqué')) pointsToRemove = 3;
    else if (eventToDelete.actionType.includes('TIR 2PTS') && !eventToDelete.actionType.includes('Manqué')) pointsToRemove = 2;
    else if (eventToDelete.actionType.includes('LANCERS FRANCS')) {
      const matchLF = eventToDelete.actionType.match(/\((\d+)\/\d+\)/);
      if (matchLF) pointsToRemove = parseInt(matchLF[1], 10);
    }

    setGame(prev => {
      const per = prev.scoreByPeriod[eventToDelete.period] || { home: 0, away: 0 };
      return {
        ...prev,
        scoreHome: Math.max(0, prev.scoreHome - pointsToRemove),
        scoreByPeriod: pointsToRemove !== 0
          ? { ...prev.scoreByPeriod, [eventToDelete.period]: { ...per, home: Math.max(0, per.home - pointsToRemove) } }
          : prev.scoreByPeriod,
        events: prev.events.filter(ev => ev.id !== eventId)
      };
    });
  };

  const getPlayerStats = (playerId: string, periodFilter: number | 'ALL') => computePlayerStats(game.events, playingTime, playerId, periodFilter);

  const handleAddOrUpdatePlayer = () => {
    if (newPlayerNumber === '' || !newPlayerName.trim()) return;
    if (editingPlayerId) {
      setEditingRoster(sortPlayersAlpha(editingRoster.map(p =>
        p.id === editingPlayerId ? { ...p, number: Number(newPlayerNumber), name: newPlayerName.trim().toUpperCase() } : p
      )));
    } else {
      const p: Player = { id: Date.now().toString(), number: Number(newPlayerNumber), name: newPlayerName.trim().toUpperCase() };
      setEditingRoster(sortPlayersAlpha([...editingRoster, p]));
    }
    setEditingPlayerId(null);
    setNewPlayerNumber('');
    setNewPlayerName('');
  };

  const handleSelectPlayerToEdit = (p: Player) => {
    setEditingPlayerId(p.id);
    setNewPlayerNumber(p.number);
    setNewPlayerName(p.name);
  };

  const handleCancelEditPlayer = () => {
    setEditingPlayerId(null);
    setNewPlayerNumber('');
    setNewPlayerName('');
  };

  const handleDeletePlayerFromEditing = () => {
    if (!editingPlayerId) return;
    setEditingRoster(editingRoster.filter(p => p.id !== editingPlayerId));
    setEditingPlayerId(null);
    setNewPlayerNumber('');
    setNewPlayerName('');
  };

  const handleLoadTeamFromSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
    setIsEditingTeamForm(false);
    setEditingPlayerId(null);
    setNewPlayerNumber('');
    setNewPlayerName('');
    if (!teamId) {
      setNewTeamName('');
      setEditingRoster([]);
      setSelectedMatchPlayerIds([]);
      return;
    }
    const team = savedTeams.find(t => t.id === teamId);
    if (team) {
      setNewTeamName(team.name);
      setMatchConfig(prev => ({ ...prev, teamHome: team.name }));
      setEditingRoster(team.roster);
      setSelectedMatchPlayerIds(team.roster.slice(0, 10).map(p => p.id));
    }
  };

  const handleToggleMatchPlayer = (pId: string) => {
    if (selectedMatchPlayerIds.includes(pId)) {
      setSelectedMatchPlayerIds(selectedMatchPlayerIds.filter(id => id !== pId));
    } else {
      if (selectedMatchPlayerIds.length >= 10) {
        alert("Vous ne pouvez pas sélectionner plus de 10 joueuses sur la feuille de match !");
        return;
      }
      setSelectedMatchPlayerIds([...selectedMatchPlayerIds, pId]);
    }
  };

  const handleApplyMatchConfig = () => {
    if (selectedMatchPlayerIds.length === 0) {
      alert("Veuillez sélectionner au moins 5 joueuses pour le match.");
      return;
    }

    const matchRoster = sortPlayersAlpha(
      editingRoster
        .filter(p => selectedMatchPlayerIds.includes(p.id))
        .map(p => ({ ...p, number: matchNumbers[p.id] ?? p.number }))
    );

    const hasProgress = game.events.length > 0 || game.scoreHome > 0 || game.scoreAway > 0;

    if (!hasProgress) {
      // Le match n'a pas encore commencé : on applique la configuration (périodes, durée...) à neuf.
      const onCourt = matchRoster.slice(0, 5).map(p => p.id);
      setStartingFiveByPeriod({ 1: onCourt });
      setGame({
        config: matchConfig,
        period: 1,
        clockSeconds: matchConfig.periodMinutes * 60,
        isClockRunning: false,
        scoreHome: 0,
        scoreAway: 0,
        scoreByPeriod: {},
        matchRoster,
        onCourtPlayerIds: onCourt,
        events: []
      });
    } else {
      // Le match est déjà en cours : on met à jour la configuration et la feuille de match
      // (dont le nombre/durée de périodes) sans toucher au score, au chrono ni à l'historique.
      setGame(prev => ({
        ...prev,
        config: matchConfig,
        matchRoster,
        onCourtPlayerIds: prev.onCourtPlayerIds.filter(id => matchRoster.some(p => p.id === id))
      }));
    }

    setActiveTab('MATCH');
  };

  const FoulSquares = ({ count, size = 'normal' }: { count: number; size?: 'normal' | 'small' }) => {
    const isExceeded = count >= 5;
    const boxSizeClass = size === 'small' ? 'w-2 h-2' : 'w-2.5 h-2.5';
    
    return (
      <div className="flex space-x-0.5 items-center">
        {[1, 2, 3, 4, 5].map(box => {
          const isFilled = count >= box;
          const isFourthBlinking = box === 4 && count === 4;
          let colorClasses = 'bg-slate-700/80 border border-slate-600/40';

          if (isExceeded) {
            colorClasses = 'bg-rose-600 shadow-sm shadow-rose-600';
          } else if (isFilled) {
            colorClasses = isFourthBlinking 
              ? 'bg-amber-400 shadow-sm shadow-amber-400 animate-pulse' 
              : 'bg-amber-400 shadow-sm shadow-amber-400';
          }

          return <div key={box} className={`${boxSizeClass} rounded-sm transition ${colorClasses}`} />;
        })}
      </div>
    );
  };

  const selectedPlayer = game.matchRoster.find(p => p.id === selectedPlayerId);
  // Le panneau d'actions est toujours affiché : sans joueuse choisie il est grisé et inactif.
  const panelPlayer: Player = selectedPlayer ?? { id: '', number: 0, name: '' };

  // Dernière période à afficher : périodes du match + prolongations jouées.
  const lastPeriodShown = Math.max(
    game.config.periodCount,
    game.period,
    ...game.events.map(e => e.period),
    ...Object.keys(game.scoreByPeriod).map(Number)
  );

  // ---------------------------------------------------------------------------
  // EXPORT PDF DES STATISTIQUES (vue affichée : match complet ou une période)
  // ---------------------------------------------------------------------------
  const handleExportStatsPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfError('');
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable: any = (await import('jspdf-autotable')).default;
      const doc: any = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW: number = doc.internal.pageSize.getWidth();
      const pageH: number = doc.internal.pageSize.getHeight();
      const M = 12;
      const NAVY: [number, number, number] = [11, 27, 58];
      const AMBER: [number, number, number] = [245, 158, 11];
      const AMBER_D: [number, number, number] = [217, 119, 6];
      const LIGHT: [number, number, number] = [241, 245, 249];
      const MUTED: [number, number, number] = [100, 116, 139];
      const TEXT: [number, number, number] = [30, 41, 59];

      // Logo (facultatif : si le chargement échoue, le PDF est généré sans)
      let logoData: string | null = null;
      try {
        const res = await fetch('/logo-stats.png');
        const blob = await res.blob();
        logoData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('logo'));
          reader.readAsDataURL(blob);
        });
      } catch { /* sans logo */ }

      const isAllView = selectedPeriodFilter === 'ALL';
      const viewLabel = isAllView ? 'Match complet' : getPeriodLabel(selectedPeriodFilter as number, game.config.periodCount);
      const ours = matchConfig.teamHome || 'Notre équipe';
      const theirs = matchConfig.teamAway || 'Adversaire';
      const weAreHome = homeAway === 'DOMICILE';
      const leftName = weAreHome ? ours : theirs;
      const rightName = weAreHome ? theirs : ours;
      const leftScore = weAreHome ? game.scoreHome : game.scoreAway;
      const rightScore = weAreHome ? game.scoreAway : game.scoreHome;
      const dateLabel = matchConfig.matchDate ? new Date(matchConfig.matchDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const pct = (made: number, att: number) => (att > 0 ? `${Math.round((made * 100) / att)}%` : '-');
      const mmss = (secs: number) => formatTime(secs);

      // ---- Bandeau d'en-tête compact sur 2 lignes : logo + titre + infos à gauche, club à droite
      const BAND_H = 19;
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, pageW, BAND_H, 'F');
      doc.setFillColor(...AMBER);
      doc.rect(0, BAND_H, pageW, 1, 'F');
      let textX = M;
      if (logoData) {
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(M, 2.5, 14, 14, 2, 2, 'F');
        doc.addImage(logoData, 'PNG', M + 0.7, 3.2, 12.6, 12.6);
        textX = M + 18;
      }
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text('Statistiques des joueuses', textX, 9.2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(191, 219, 254);
      doc.text(`${dateLabel ? dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1) + '   |   ' : ''}Match ${matchType === 'OFFICIEL' ? 'officiel' : 'amical'}   |   Vue : ${viewLabel}`, textX, 14.6);
      doc.setTextColor(...AMBER);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('OLYMPIC SATHONAY', pageW - M, 11.5, { align: 'right' });

      // ---- Score : noms à gauche et à droite (sur 2 lignes si besoin), score au centre
      const nameW = pageW / 2 - 26 - M;
      const scoreMidY = 31;
      const lineH = 4.6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      const leftLines: string[] = (doc.splitTextToSize(leftName, nameW) as string[]).slice(0, 2);
      const rightLines: string[] = (doc.splitTextToSize(rightName, nameW) as string[]).slice(0, 2);
      const drawLines = (lines: string[], x: number, align: 'left' | 'right') =>
        lines.forEach((ln, i) => doc.text(ln, x, scoreMidY + 1.4 - ((lines.length - 1) * lineH) / 2 + i * lineH, { align }));
      drawLines(leftLines, pageW / 2 - 26, 'right');
      drawLines(rightLines, pageW / 2 + 26, 'left');
      doc.setFontSize(22);
      doc.setTextColor(...AMBER_D);
      doc.text(`${leftScore}  -  ${rightScore}`, pageW / 2, scoreMidY + 3.2, { align: 'center' });

      // ---- Score par période (à gauche) et meilleures performances (à droite)
      const periodsShown = Array.from({ length: lastPeriodShown }, (_, i) => i + 1);
      const periodScore = (side: 'home' | 'away', p: number) => {
        const s = game.scoreByPeriod[p];
        return s ? String(s[side]) : '-';
      };
      autoTable(doc, {
        startY: 40,
        margin: { left: M, right: pageW - M - 150, top: 24, bottom: 16 },
        head: [['', ...periodsShown.map(p => getPeriodLabel(p, game.config.periodCount)), 'Total']],
        body: [
          [ours, ...periodsShown.map(p => periodScore('home', p)), String(game.scoreHome)],
          [theirs, ...periodsShown.map(p => periodScore('away', p)), String(game.scoreAway)]
        ],
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: TEXT, halign: 'center', lineColor: [226, 232, 240] },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 72 } },
        didParseCell: (d: any) => { if (d.section === 'body' && d.column.index === periodsShown.length + 1) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [254, 243, 199]; } }
      });
      const periodsBottom: number = doc.lastAutoTable.finalY;

      const withStats = game.matchRoster.map(p => ({ p, st: getPlayerStats(p.id, selectedPeriodFilter) }));
      const best = (label: string, value: (s: ReturnType<typeof getPlayerStats>) => number) => {
        const top = [...withStats].sort((a, b) => value(b.st) - value(a.st))[0];
        return top && value(top.st) > 0 ? `${label} : ${top.p.name} (${value(top.st)})` : `${label} : -`;
      };
      const cardX = M + 156;
      const cardW = pageW - M - cardX;
      const cardY = 40;
      doc.setFillColor(...LIGHT);
      doc.roundedRect(cardX, cardY, cardW, 29, 3, 3, 'F');
      doc.setFillColor(...AMBER);
      doc.rect(cardX, cardY, 1.6, 29, 'F');
      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Meilleures performances', cardX + 6, cardY + 6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...TEXT);
      doc.text(best('Points', s => s.points), cardX + 6, cardY + 11.5);
      doc.text(best('Rebonds', s => s.rebOff + s.rebDef), cardX + 6, cardY + 16.3);
      doc.text(best('Passes décisives', s => s.assists), cardX + 6, cardY + 21.1);
      doc.text(best('Évaluation', s => s.evaluation), cardX + 6, cardY + 25.9);

      // ---- Tableau principal : tient TOUJOURS sur la page 1 (la hauteur des lignes s'adapte à l'espace libre)
      const head = [['#', 'Joueuse', 'PTS', '2PTS', '3PTS', 'LF', 'TIR %', 'REB O', 'REB D', 'REB', 'AST', 'INT', 'BP', 'CT', 'CTS', 'FT', 'FS', 'ÉVAL', 'Temps']];
      const rowOf = (p: Player, st: ReturnType<typeof getPlayerStats>) => [
        `#${p.number}`, p.name, String(st.points), `${st.pts2Made}/${st.pts2Att}`, `${st.pts3Made}/${st.pts3Att}`, `${st.ftMade}/${st.ftAttempted}`,
        pct(st.pts2Made + st.pts3Made, st.pts2Att + st.pts3Att), String(st.rebOff), String(st.rebDef), String(st.rebOff + st.rebDef),
        String(st.assists), String(st.steals), String(st.turnovers), String(st.blocks), String(st.blocksAgainst),
        String(st.fouls), String(st.foulsDrawn), String(st.evaluation), mmss(st.totalSecs)
      ];
      const sum = (f: (s: ReturnType<typeof getPlayerStats>) => number) => withStats.reduce((t, x) => t + f(x.st), 0);
      const totals = [
        '', 'ÉQUIPE', String(sum(s => s.points)), `${sum(s => s.pts2Made)}/${sum(s => s.pts2Att)}`, `${sum(s => s.pts3Made)}/${sum(s => s.pts3Att)}`,
        `${sum(s => s.ftMade)}/${sum(s => s.ftAttempted)}`, pct(sum(s => s.pts2Made + s.pts3Made), sum(s => s.pts2Att + s.pts3Att)),
        String(sum(s => s.rebOff)), String(sum(s => s.rebDef)), String(sum(s => s.rebOff + s.rebDef)), String(sum(s => s.assists)),
        String(sum(s => s.steals)), String(sum(s => s.turnovers)), String(sum(s => s.blocks)), String(sum(s => s.blocksAgainst)),
        String(sum(s => s.fouls)), String(sum(s => s.foulsDrawn)), String(sum(s => s.evaluation)), mmss(sum(s => s.totalSecs))
      ];
      const mainStartY = Math.max(periodsBottom, cardY + 29) + 5;
      const rowsCount = withStats.length + 2; // + ligne d'en-tête + ligne ÉQUIPE
      const rowH = Math.min(10.5, (pageH - 18 - mainStartY) / rowsCount);
      const padV = Math.max(1, (rowH - 3.7) / 2);
      const tableStyles = {
        styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: padV, bottom: padV, left: 1.2, right: 1.2 }, textColor: TEXT, halign: 'center' as const, lineColor: [226, 232, 240] },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' as const },
        alternateRowStyles: { fillColor: LIGHT },
        footStyles: { fillColor: [254, 243, 199], textColor: NAVY, fontStyle: 'bold' as const },
        columnStyles: { 0: { fontStyle: 'bold' as const, textColor: AMBER_D, cellWidth: 14 }, 1: { halign: 'left' as const, fontStyle: 'bold' as const, cellWidth: 46 }, 2: { fontStyle: 'bold' as const }, 17: { fontStyle: 'bold' as const, textColor: [5, 150, 105] as [number, number, number] } },
        theme: 'grid' as const
      };
      autoTable(doc, {
        ...tableStyles,
        startY: mainStartY,
        margin: { left: M, right: M, top: 24, bottom: 16 },
        head,
        body: withStats.map(({ p, st }) => rowOf(p, st)),
        foot: [totals],
        showFoot: 'lastPage'
      });

      // ---- Détail période par période (vue "Match complet")
      if (isAllView && periodsShown.length > 1) {
        periodsShown.forEach(pNum => {
          const rows = game.matchRoster.map(p => ({ p, st: getPlayerStats(p.id, pNum) }));
          const tot = (f: (s: ReturnType<typeof getPlayerStats>) => number) => rows.reduce((t, x) => t + f(x.st), 0);
          const per = game.scoreByPeriod[pNum];
          doc.addPage();
          doc.setFillColor(...NAVY);
          doc.roundedRect(M, 24, pageW - 2 * M, 10, 2, 2, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.text(`Détail - ${getPeriodLabel(pNum, game.config.periodCount)}`, M + 5, 30.7);
          doc.setTextColor(...AMBER);
          doc.text(per ? `${ours} ${per.home} - ${per.away} ${theirs}` : '', pageW - M - 5, 30.7, { align: 'right' });
          autoTable(doc, {
            ...tableStyles,
            startY: 38,
            margin: { left: M, right: M, top: 24, bottom: 16 },
            head,
            body: rows.map(({ p, st }) => rowOf(p, st)),
            foot: [[
              '', 'ÉQUIPE', String(tot(s => s.points)), `${tot(s => s.pts2Made)}/${tot(s => s.pts2Att)}`, `${tot(s => s.pts3Made)}/${tot(s => s.pts3Att)}`,
              `${tot(s => s.ftMade)}/${tot(s => s.ftAttempted)}`, pct(tot(s => s.pts2Made + s.pts3Made), tot(s => s.pts2Att + s.pts3Att)),
              String(tot(s => s.rebOff)), String(tot(s => s.rebDef)), String(tot(s => s.rebOff + s.rebDef)), String(tot(s => s.assists)),
              String(tot(s => s.steals)), String(tot(s => s.turnovers)), String(tot(s => s.blocks)), String(tot(s => s.blocksAgainst)),
              String(tot(s => s.fouls)), String(tot(s => s.foulsDrawn)), String(tot(s => s.evaluation)), mmss(tot(s => s.totalSecs))
            ]],
            showFoot: 'lastPage'
          });
        });
      }

      // ---- Légende (dernière page) puis en-têtes fins + pieds de page
      const lastY: number = doc.lastAutoTable.finalY;
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const legend = 'PTS : points | 2PTS / 3PTS / LF : réussis sur tentés | TIR % : réussite aux tirs à 2 et 3 points | REB O / D : rebonds offensifs / défensifs | AST : passes décisives | INT : interceptions | BP : balles perdues | CT : contres | CTS : contres subis | FT : fautes commises (techniques, antisportives et disqualifiantes comprises) | FS : fautes subies | ÉVAL : évaluation = (points + rebonds + passes décisives + interceptions + contres + fautes subies) - (tirs et lancers francs manqués + balles perdues + fautes commises + contres subis) | Temps : temps de jeu';
      doc.text(doc.splitTextToSize(legend, pageW - 2 * M), M, Math.min(lastY + 8, pageH - 22));

      const pages: number = doc.getNumberOfPages();
      const generated = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        if (i > 1) {
          doc.setFillColor(...NAVY);
          doc.rect(0, 0, pageW, 14, 'F');
          doc.setFillColor(...AMBER);
          doc.rect(0, 14, pageW, 0.9, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text('Statistiques des joueuses', M, 9);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(191, 219, 254);
          doc.text(`${leftName} ${leftScore} - ${rightScore} ${rightName}`, pageW - M, 9, { align: 'right' });
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(M, pageH - 11, pageW - M, pageH - 11);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text('TeamStats - Olympic Sathonay', M, pageH - 6.5);
        doc.text(`Document généré le ${generated}`, pageW / 2, pageH - 6.5, { align: 'center' });
        doc.text(`Page ${i} / ${pages}`, pageW - M, pageH - 6.5, { align: 'right' });
      }

      const slug = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      doc.save(`Stats-${slug(ours)}-vs-${slug(theirs)}-${matchConfig.matchDate || 'match'}-${slug(viewLabel)}.pdf`);
    } catch (err) {
      console.error(err);
      setPdfError(err instanceof Error ? err.message : 'Échec de la génération du PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const availableSeasons = Array.from(new Set([...existingMatches, ...upcomingMatches].map(m => getSeasonLabel(m.match_date)))).filter(Boolean).sort().reverse();
  const pickerTeamNames = Array.from(new Set(savedTeams.map(t => t.name)));

  // Seuls les matchs OFFICIELS sont listés. JOUÉ = matchs enregistrés (stats_matches, du plus récent
  // au plus ancien) ; À VENIR = calendrier de l'appli principale pas encore enregistré (du plus proche
  // au plus lointain). TOUS = à venir puis joués : une frise autour d'aujourd'hui.
  const recordedFfbbIds = new Set(existingMatches.map(m => String(m.ffbb_match_id || '')));
  const playedEntries = existingMatches
    .filter(m => !String(m.ffbb_match_id || '').startsWith('AMICAL-'))
    .filter(m => pickerTeamFilter === 'ALL' || m.team_home === pickerTeamFilter || m.team_away === pickerTeamFilter)
    .filter(m => pickerSeasonFilter === 'ALL' || getSeasonLabel(m.match_date) === pickerSeasonFilter)
    .sort((a, b) => String(b.match_date || '').localeCompare(String(a.match_date || '')))
    .map(m => ({ kind: 'JOUE' as const, key: `p-${m.id}`, m }));
  const upcomingEntries = upcomingMatches
    .filter(u => !recordedFfbbIds.has(String(u.ffbb_rencontre_id || '')))
    .filter(u => pickerTeamFilter === 'ALL' || sameCategory(pickerTeamFilter, [u.category, u.our_team_name, u.division_label]))
    .filter(u => pickerSeasonFilter === 'ALL' || getSeasonLabel(u.match_date) === pickerSeasonFilter)
    .sort((a, b) => String(a.match_date || '').localeCompare(String(b.match_date || '')))
    .map(u => ({ kind: 'A_VENIR' as const, key: `u-${u.ffbb_rencontre_id}`, u }));
  const pickerEntries: any[] =
    pickerStatusFilter === 'JOUE' ? playedEntries
    : pickerStatusFilter === 'A_VENIR' ? upcomingEntries
    : [...upcomingEntries, ...playedEntries];

  return (
    <div className="max-w-3xl mx-auto min-h-screen pb-12 pt-4 px-2">
      <header className="bg-slate-900/90 backdrop-blur-md text-white rounded-2xl border border-slate-700/50 shadow-lg mb-4">
        <div className="flex justify-between items-center px-4 py-2.5">
          <div className="flex items-center space-x-2.5">
            <span className="font-extrabold tracking-wider text-amber-500 text-sm uppercase">Olympic Sathonay</span>
            <button
              onClick={() => { void flushPending(true); void syncOfflineData(); }}
              title={!isOnline ? "Hors connexion : les saisies sont gardées sur l'appareil" : pendingCount > 0 ? 'Toucher pour envoyer maintenant' : 'Toucher pour synchroniser les données'}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide ${!isOnline ? 'border-amber-400/60 text-amber-300 bg-amber-500/10' : pendingCount > 0 ? 'border-blue-400/60 text-blue-300 bg-blue-500/10' : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${!isOnline ? 'bg-amber-400' : pendingCount > 0 ? 'bg-blue-400' : 'bg-emerald-400'}`} />
              <span>{!isOnline ? `Hors ligne${pendingCount > 0 ? ` · ${pendingCount}` : ''}` : isSyncing ? 'Envoi…' : pendingCount > 0 ? `${pendingCount} à envoyer` : 'En ligne'}</span>
            </button>
            <span title={userEmail} className={`hidden sm:inline px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide ${isAdmin ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' : 'border-blue-400/50 text-blue-300 bg-blue-500/10'}`}>{role}</span>
            <button
              onClick={onSignOut}
              title={`Se déconnecter (${userEmail})`}
              aria-label="Se déconnecter"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-xs transition"
            >⏻</button>
          </div>
          
          <nav className="flex space-x-1.5 bg-slate-800 p-1 rounded-xl text-base font-semibold border border-slate-700/60">
            <button onClick={() => setActiveTab('INIT')} title="Configuration" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'INIT' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>⚙️</button>
            <button onClick={() => setActiveTab('MATCH')} title="Direct" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'MATCH' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>🏀</button>
            <button onClick={() => setActiveTab('STATS')} title="Statistiques" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'STATS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>📊</button>
            <button onClick={() => setActiveTab('LOGS')} title="Historique" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'LOGS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>🕒</button>
            <span className="w-px h-6 bg-slate-700 self-center mx-0.5" />
            <button
              onClick={handleSaveMatch}
              disabled={saveStatus === 'saving'}
              title="Enregistrer le match et les statistiques"
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${
                saveStatus === 'saved' ? 'bg-emerald-600 text-white' :
                saveStatus === 'queued' ? 'bg-blue-600 text-white' :
                saveStatus === 'error' ? 'bg-rose-600 text-white' :
                saveStatus === 'saving' ? 'bg-slate-700 text-slate-400' :
                'text-slate-400 hover:text-white'
              }`}
            >{saveStatus === 'saving' ? '⏳' : saveStatus === 'saved' ? '✅' : saveStatus === 'queued' ? '📥' : saveStatus === 'error' ? '⚠️' : '💾'}</button>
          </nav>
        </div>
        {saveStatus === 'error' && (
          <p className="text-center text-[10px] text-rose-400 pb-1 px-2 break-words">Échec de l'enregistrement : {saveErrorMessage || 'vérifie la connexion Supabase.'}</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-center text-[10px] text-emerald-400 pb-1">Match et statistiques enregistrés.</p>
        )}
        {saveStatus === 'queued' && (
          <p className="text-center text-[10px] text-blue-300 pb-1 px-2">Enregistré sur l'appareil (pas de réseau). Envoi automatique dès le retour de la connexion.</p>
        )}
        {!isOnline && saveStatus !== 'queued' && (
          <p className="text-center text-[10px] text-amber-300 pb-1 px-2">Mode hors ligne : vos saisies restent sur l'appareil et partiront au retour du réseau.</p>
        )}
        {isOnline && pendingCount > 0 && !isSyncing && (
          <p className="text-center text-[10px] text-blue-300 pb-1 px-2">{pendingCount} match{pendingCount > 1 ? 's' : ''} en attente d'envoi : touchez la pastille pour réessayer.</p>
        )}
        {syncMessage && (
          <p className="text-center text-[10px] text-emerald-300 pb-1 px-2 break-words">{syncMessage}</p>
        )}
        {needsReauth && (
          <p className="text-center text-[10px] text-rose-300 pb-1 px-2">
            Session expirée : reconnectez-vous pour envoyer vos données.{' '}
            <button onClick={onReauth} className="underline font-bold">Se reconnecter</button>
          </p>
        )}
        {restoredAt && (
          <p className="text-center text-[10px] text-slate-300 pb-1.5 px-2">
            Match repris depuis cet appareil (sauvegarde locale de {new Date(restoredAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}).{' '}
            <button onClick={handleNewMatch} className="underline font-bold text-amber-300">Nouveau match</button>
            <button onClick={() => setRestoredAt(null)} className="ml-2 text-slate-500 hover:text-white" aria-label="Masquer">✕</button>
          </p>
        )}
      </header>

      <main>
        {activeTab === 'INIT' && (
          <div className="space-y-4">

            {/* 1. ÉQUIPES & JOUEUSES */}
            <div className="bg-slate-900/90 text-white p-6 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-amber-400 uppercase">Équipes &amp; Joueuses</h2>
                <div className="flex items-center space-x-2">
                  <span className="hidden sm:inline text-[10px] text-slate-500" title="Dernière synchronisation des équipes, joueuses et matchs à venir">
                    {dataSyncedAt ? `Synchro : ${new Date(dataSyncedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Jamais synchronisé'}
                  </span>
                  <button onClick={() => { void syncOfflineData(); }} disabled={isLoadingTeams} title="Récupère équipes, joueuses et matchs à venir (et les garde pour le hors ligne)" className="text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1 rounded-lg border border-slate-700">
                    {isLoadingTeams ? 'Chargement...' : '🔄 Synchroniser'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-stats.png"
                alt="Statistiques basket"
                title="Double-clic pour agrandir"
                onClick={() => {
                  const now = Date.now();
                  if (now - lastLogoTapRef.current < 400) { setShowLogoFull(true); lastLogoTapRef.current = 0; }
                  else lastLogoTapRef.current = now;
                }}
                style={{ touchAction: 'manipulation' }}
                className="w-28 h-28 sm:w-56 sm:h-56 shrink-0 self-center sm:self-start cursor-zoom-in select-none"
              />
              {showLogoFull && (
                <div onClick={() => setShowLogoFull(false)} className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 cursor-zoom-out">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-stats-full.png" alt="Statistiques basket" className="max-w-full max-h-full object-contain" />
                  <button onClick={() => setShowLogoFull(false)} aria-label="Fermer" className="absolute top-3 right-3 w-10 h-10 rounded-full bg-slate-800/90 text-white text-lg font-bold border border-slate-600">✕</button>
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-4">
              <div className="flex items-end space-x-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Choisir une équipe</label>
                  <select value={selectedTeamId} onChange={e => handleLoadTeamFromSelect(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none">
                    <option value="">{isAdmin ? '-- Créer une nouvelle équipe --' : '-- Choisir une équipe --'}</option>
                    {savedTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.roster.length} joueuses)</option>
                    ))}
                  </select>
                </div>
                <button onClick={() => setIsEditingTeamForm(v => !v)} title="Créer / modifier l'effectif de l'équipe" className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border transition ${isEditingTeamForm ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>✏️</button>
              </div>

              {(isEditingTeamForm || !selectedTeamId) && (isAdmin || !!selectedTeamId) && (
                <div className="space-y-3">
                  <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/60 space-y-3">
                    <p className="text-xs font-bold text-slate-300">{editingPlayerId ? 'Modifier la joueuse sélectionnée' : 'Ajouter une joueuse dans l\'effectif actuel'}</p>
                    <div className="flex space-x-2">
                      <input type="number" placeholder="N°" value={newPlayerNumber} onChange={e => setNewPlayerNumber(e.target.value ? parseInt(e.target.value) : '')} className="w-20 bg-slate-800 border border-slate-700 rounded-xl p-2 text-sm font-bold text-center text-white" />
                      <input type="text" placeholder="Nom de la joueuse" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl p-2 text-sm font-bold text-white" />
                      <button onClick={handleAddOrUpdatePlayer} className="bg-blue-600 hover:bg-blue-500 font-bold px-4 py-2 rounded-xl text-xs shrink-0">{editingPlayerId ? 'Mettre à jour' : 'Ajouter'}</button>
                      {editingPlayerId && (
                        <>
                          <button onClick={handleDeletePlayerFromEditing} title="Supprimer cette joueuse" className="bg-rose-600 hover:bg-rose-500 font-bold px-3 py-2 rounded-xl text-xs shrink-0">🗑️</button>
                          <button onClick={handleCancelEditPlayer} title="Annuler" className="bg-slate-700 hover:bg-slate-600 font-bold px-3 py-2 rounded-xl text-xs shrink-0">✖</button>
                        </>
                      )}
                    </div>
                    {editingRoster.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {editingRoster.map(p => (
                          <button
                            key={p.id}
                            onClick={() => handleSelectPlayerToEdit(p)}
                            className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition ${editingPlayerId === p.id ? 'bg-amber-500/20 border-amber-500 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                          >#{p.number} {p.name}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex space-x-2 items-center">
                    <input type="text" placeholder="Nom de l'équipe (ex: U15F)" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} className="flex-1 bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white" />
                    <button onClick={handleSaveTeamToSupabase} disabled={teamSaveStatus === 'saving'} className="bg-emerald-600 hover:bg-emerald-500 font-bold px-4 py-2.5 rounded-xl text-xs shrink-0">
                      {teamSaveStatus === 'saving' ? 'Enregistrement...' : 'Mettre à jour'}
                    </button>
                  </div>
                  {teamSaveStatus === 'saved' && <p className="text-[10px] text-emerald-400">Équipe enregistrée.</p>}
                  {teamSaveStatus === 'error' && <p className="text-[10px] text-rose-400">Échec de l'enregistrement.</p>}
                </div>
              )}
              </div>
              </div>
            </div>

            {/* 2. MATCH */}
            <div className="bg-slate-900/90 text-white p-6 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <div className="flex items-center space-x-3">
                  <h2 className="text-xl font-bold text-amber-400">Match</h2>
                  <button onClick={handleNewMatch} title="Effacer l'écran et repartir sur un nouveau match" className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">🆕 Nouveau</button>
                </div>
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-full p-1 text-xs font-black">
                  <button onClick={() => setMatchType('OFFICIEL')} className={`px-3 py-1.5 rounded-full transition ${matchType === 'OFFICIEL' ? 'bg-amber-600 text-white shadow' : 'text-slate-400'}`}>OFFICIEL</button>
                  <button onClick={() => setMatchType('AMICAL')} className={`px-3 py-1.5 rounded-full transition ${matchType === 'AMICAL' ? 'bg-blue-600 text-white shadow' : 'text-slate-400'}`}>AMICAL</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className={homeAway === 'DOMICILE' ? 'order-1' : 'order-2'}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-400">{homeAway === 'DOMICILE' ? 'Équipe Domicile' : 'Équipe Extérieure'}</label>
                    <div className="flex items-center bg-slate-800 border border-slate-700 rounded-full p-0.5 text-[9px] font-black">
                      <button onClick={() => setHomeAway('DOMICILE')} className={`px-2 py-0.5 rounded-full transition ${homeAway === 'DOMICILE' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}>DOM</button>
                      <button onClick={() => setHomeAway('EXTERIEUR')} className={`px-2 py-0.5 rounded-full transition ${homeAway === 'EXTERIEUR' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>EXT</button>
                    </div>
                  </div>
                  <select value={selectedTeamId} onChange={e => handleLoadTeamFromSelect(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none">
                    <option value="">-- Choisir une équipe --</option>
                    {savedTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className={homeAway === 'DOMICILE' ? 'order-2' : 'order-1'}>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">{homeAway === 'DOMICILE' ? 'Équipe Extérieure' : 'Équipe Domicile'}</label>
                  <input
                    type="text"
                    list="club-names-list"
                    disabled={matchType === 'OFFICIEL'}
                    value={matchConfig.teamAway}
                    onChange={e => setMatchConfig({...matchConfig, teamAway: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <datalist id="club-names-list">
                    {clubNames.map(name => <option key={name} value={name} />)}
                  </datalist>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 -mt-2">Notre équipe vient obligatoirement de la liste "Équipes &amp; Joueuses" ci-dessus. On ne joue pas forcément à domicile : utilise le flag DOM/EXT.{matchType === 'OFFICIEL' && ` En officiel, l'adversaire se remplit via l'ID FFBB.`}</p>

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Date du match</label>
                  <input type="date" value={matchConfig.matchDate} onChange={e => setMatchConfig({...matchConfig, matchDate: e.target.value})} className="bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Périodes</label>
                  <input type="number" min="1" max="49" value={matchConfig.periodCount} onChange={e => setMatchConfig({...matchConfig, periodCount: Math.min(49, Math.max(1, parseInt(e.target.value) || 1))})} className="w-16 bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white text-center focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Durée (min)</label>
                  <input type="number" min="1" max="49" value={matchConfig.periodMinutes} onChange={e => setMatchConfig({...matchConfig, periodMinutes: Math.min(49, Math.max(1, parseInt(e.target.value) || 1))})} className="w-16 bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white text-center focus:outline-none" />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">ID FFBB Match {isLookingUpFfbb && <span className="text-amber-400">(recherche...)</span>}{ffbbLookupStatus === 'notfound' && <span className="text-rose-400">(introuvable)</span>}{ffbbLookupStatus === 'error' && <span className="text-rose-400">(erreur)</span>}{ffbbLookupStatus === 'found' && <span className="text-emerald-400">(trouvé ✓)</span>}</label>
                  <div className="flex space-x-1.5">
                    <input
                      type="text"
                      maxLength={20}
                      placeholder="ex: 200000014737720"
                      value={matchConfig.ffbbMatchId}
                      onChange={e => { setFfbbLookupStatus('idle'); setMatchConfig({...matchConfig, ffbbMatchId: e.target.value.slice(0, 20)}); }}
                      onBlur={e => fetchFfbbMatchInfo(e.target.value)}
                      className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none"
                    />
                    <button onClick={openFfbbPicker} title="Rechercher un match (joué ou à venir)" className="shrink-0 w-10 h-10 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 text-lg">🔍</button>
                  </div>
                  {ffbbLookupStatus === 'error' && (
                    <p className="text-[10px] text-rose-400 mt-1 break-words">{ffbbLookupError} (as-tu exécuté sql/ffbb_lookup.sql ?)</p>
                  )}
                </div>
              </div>
            </div>

            {/* 3. FEUILLE DE MATCH */}
            <div className={isSheetExpanded
              ? 'fixed inset-0 z-50 overflow-y-auto bg-slate-950 text-white p-5 space-y-4'
              : 'bg-slate-900/90 text-white p-6 rounded-3xl space-y-4 border border-white/10 shadow-2xl'}>
              {/* Double-clic (ou double tape) sur le bandeau : feuille de match en grand, un second double-clic la remet à sa taille. */}
              <div
                onDoubleClick={() => setIsSheetExpanded(v => !v)}
                title="Double-clic : agrandir / réduire"
                className={`flex justify-between items-center border-b border-slate-700 pb-3 cursor-pointer select-none touch-manipulation ${isSheetExpanded ? 'sticky top-0 z-10 bg-slate-950 pt-1' : ''}`}
              >
                <h2 className="text-xl font-bold text-amber-400">Feuille de Match</h2>
                <div className="flex items-center space-x-3">
                  <span className={`text-xs font-black ${selectedMatchPlayerIds.length === 10 ? 'text-amber-400' : 'text-slate-400'}`}>{selectedMatchPlayerIds.length} / 10 max</span>
                  <button
                    onClick={() => setIsSheetExpanded(v => !v)}
                    title={isSheetExpanded ? 'Réduire' : 'Agrandir'}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-sm"
                  >{isSheetExpanded ? '⤡' : '⤢'}</button>
                </div>
              </div>
              <div className={isSheetExpanded ? 'space-y-3' : 'space-y-2 max-h-64 overflow-y-auto pr-1'}>
                {editingRoster.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Choisis ou crée une équipe ci-dessus pour constituer la feuille de match.</p>
                ) : (
                  editingRoster.map(p => {
                    const isSelected = selectedMatchPlayerIds.includes(p.id);
                    const matchNumber = matchNumbers[p.id] ?? p.number;
                    return (
                      <div key={p.id} className={`flex items-center justify-between rounded-xl border font-bold transition ${isSheetExpanded ? 'p-4 text-base' : 'p-2 text-xs'} ${isSelected ? 'bg-amber-500/20 border-amber-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                        <button onClick={() => handleToggleMatchPlayer(p.id)} className="flex items-center space-x-2 flex-1 text-left">
                          <span className="text-sm">{isSelected ? '✓' : '+'}</span>
                          <span className="truncate">{p.name}</span>
                        </button>
                        <div className="flex items-center space-x-1 shrink-0">
                          <span className="text-[9px] text-slate-500 uppercase">N° match</span>
                          <input
                            type="number"
                            value={matchNumber}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setMatchNumbers({ ...matchNumbers, [p.id]: parseInt(e.target.value) || 0 })}
                            className="w-12 bg-slate-900 border border-slate-700 rounded-lg p-1 text-center text-white"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <button onClick={handleApplyMatchConfig} className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3.5 rounded-xl shadow-lg transition">Démarrer / Mettre à jour le match</button>
          </div>
        )}

        {showFfbbPicker && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowFfbbPicker(false)}>
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <h3 className="text-sm font-bold text-amber-400">Matchs</h3>
                <button onClick={() => setShowFfbbPicker(false)} className="text-xs text-slate-400 hover:text-white font-bold">Fermer ✖</button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-full p-1 text-[10px] font-black w-fit">
                  <button onClick={() => setPickerStatusFilter('JOUE')} className={`px-2.5 py-1 rounded-full transition ${pickerStatusFilter === 'JOUE' ? 'bg-amber-600 text-white shadow' : 'text-slate-400'}`}>JOUÉ</button>
                  <button onClick={() => setPickerStatusFilter('A_VENIR')} className={`px-2.5 py-1 rounded-full transition ${pickerStatusFilter === 'A_VENIR' ? 'bg-blue-600 text-white shadow' : 'text-slate-400'}`}>À VENIR</button>
                  <button onClick={() => setPickerStatusFilter('ALL')} className={`px-2.5 py-1 rounded-full transition ${pickerStatusFilter === 'ALL' ? 'bg-slate-600 text-white shadow' : 'text-slate-400'}`}>TOUS</button>
                </div>
                {/* Indicateur (non cliquable) : seuls les matchs officiels sont listés. */}
                <span title="Seuls les matchs officiels sont listés" className="px-2.5 py-1 rounded-full bg-amber-600/20 border border-amber-500/40 text-amber-400 text-[10px] font-black select-none">OFFICIEL</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select value={pickerTeamFilter} onChange={e => setPickerTeamFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs font-bold text-white focus:outline-none">
                  <option value="ALL">Toutes les équipes</option>
                  {pickerTeamNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <select value={pickerSeasonFilter} onChange={e => setPickerSeasonFilter(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs font-bold text-white focus:outline-none">
                  <option value="ALL">Toutes les saisons</option>
                  {availableSeasons.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {pickerNotice && <p className="text-[11px] text-amber-300 break-words">{pickerNotice}</p>}
              {!isOnline && !pickerNotice && <p className="text-[10px] text-slate-400">Hors connexion : listes de la dernière synchronisation. Un match « À VENIR » reste utilisable ; rouvrir un match enregistré demande le réseau.</p>}

              {upcomingError && pickerStatusFilter !== 'JOUE' && (
                <p className="text-[10px] text-rose-400 break-words">Calendrier à venir indisponible : {upcomingError} (as-tu exécuté sql/ffbb_upcoming.sql ?)</p>
              )}

              {isLoadingExistingMatches ? (
                <p className="text-xs text-slate-400 text-center py-4">Chargement...</p>
              ) : pickerEntries.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Aucun match ne correspond à ces filtres.</p>
              ) : (
                <div className="space-y-2">
                  {pickerEntries.map(entry => entry.kind === 'JOUE' ? (
                    <div key={entry.key} className="w-full text-left p-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-amber-500 transition flex items-center space-x-2">
                      <button onClick={() => handleSelectExistingMatch(entry.m)} className="flex-1 text-left min-w-0">
                        <div className="flex justify-between items-start gap-2 text-xs">
                          <span className="font-bold text-white break-words">{entry.m.team_home} vs {entry.m.team_away}</span>
                          <span className="font-bold text-slate-300 shrink-0">{entry.m.score_home} - {entry.m.score_away}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                          <span className="truncate">
                            {entry.m.match_date ? new Date(entry.m.match_date).toLocaleDateString('fr-FR') : 'Date inconnue'}
                            {' · '}
                            {`ID : ${entry.m.ffbb_match_id}`}
                            {entry.m.created_at && (
                              <span className="text-slate-600"> (enregistré le {new Date(entry.m.created_at).toLocaleDateString('fr-FR')} à {new Date(entry.m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})</span>
                            )}
                          </span>
                        </div>
                      </button>
                      <button onClick={() => setMatchToDelete(entry.m)} title="Supprimer ce match" className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 hover:bg-rose-900/60 text-rose-400 transition">🗑️</button>
                    </div>
                  ) : (() => {
                    const u = entry.u;
                    const ours = findOurTeamForUpcoming(u)?.name || u.our_team_name || u.category || 'Notre équipe';
                    const weAreAway = String(u.home_away || '').toLowerCase().startsWith('ext');
                    const d = u.match_date ? new Date(u.match_date) : null;
                    const hasTime = !!d && (d.getHours() !== 0 || d.getMinutes() !== 0);
                    return (
                      <div key={entry.key} className="w-full text-left p-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-blue-500 transition">
                        <button onClick={() => handleSelectUpcomingMatch(u)} className="w-full text-left min-w-0">
                          <div className="flex justify-between items-start gap-2 text-xs">
                            <span className="font-bold text-white break-words">{weAreAway ? `${u.opponent} vs ${ours}` : `${ours} vs ${u.opponent}`}</span>
                            <span className="shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-600/80 text-white">À VENIR</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1 truncate">
                            {d ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Date inconnue'}
                            {hasTime && d ? ` à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                            {u.numero_journee ? ` · J${u.numero_journee}` : ''}
                            {` · ID : ${u.ffbb_rencontre_id}`}
                          </div>
                        </button>
                      </div>
                    );
                  })())}
                </div>
              )}
            </div>
          </div>
        )}

        {matchToDelete && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => !isDeletingMatch && setMatchToDelete(null)}>
            <div className="bg-slate-900 border border-rose-600/60 rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-rose-400">Supprimer ce match ?</h3>
              <p className="text-xs text-slate-300">
                <span className="font-bold text-white">{matchToDelete.team_home} vs {matchToDelete.team_away}</span> ({matchToDelete.match_date || 'date inconnue'}) sera définitivement supprimé, avec tous ses événements et statistiques. Cette action est irréversible.
              </p>
              {isDisplayedMatch(matchToDelete) && (
                <p className="text-[11px] text-amber-300">C'est le match affiché à l'écran : il sera aussi remis à zéro (actions, score, temps de jeu).</p>
              )}
              <div className="flex space-x-2">
                <button onClick={() => setMatchToDelete(null)} disabled={isDeletingMatch} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition">Annuler</button>
                <button onClick={handleDeleteMatch} disabled={isDeletingMatch} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-sm transition">{isDeletingMatch ? 'Suppression...' : 'Supprimer'}</button>
              </div>
            </div>
          </div>
        )}

        {confirmResetPeriod && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => setConfirmResetPeriod(false)}>
            <div className="bg-slate-900 border border-rose-600/60 rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-rose-400">Réinitialiser {getPeriodLabel(game.period, game.config.periodCount)} ?</h3>
              <p className="text-xs text-slate-300">
                Le chrono repart à <span className="font-bold text-white">{formatTime((game.period > game.config.periodCount ? OVERTIME_MINUTES : game.config.periodMinutes) * 60)}</span> et toutes les actions déjà enregistrées pour cette période (temps de jeu inclus) seront effacées de l'historique. Le score revient à celui de la fin de la période précédente (<span className="font-bold text-white">{game.scoreHome - (game.scoreByPeriod[game.period]?.home ?? 0)} - {game.scoreAway - (game.scoreByPeriod[game.period]?.away ?? 0)}</span>). Les autres périodes ne sont pas concernées. Cette action est irréversible.
              </p>
              <div className="flex space-x-2">
                <button onClick={() => setConfirmResetPeriod(false)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition">Annuler</button>
                <button onClick={handleConfirmResetPeriod} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-sm transition">Réinitialiser</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'MATCH' && (
          <div className="space-y-4">
            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 text-white p-4 rounded-3xl shadow-2xl">
              <div className="grid grid-cols-3 items-center text-center">
                <div className={`flex flex-col items-center ${homeAway === 'DOMICILE' ? 'order-1' : 'order-3'}`}>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{matchConfig.teamHome || (homeAway === 'DOMICILE' ? 'DOMICILE' : 'EXTÉRIEUR')}</p>
                  <p className="text-4xl font-black text-amber-400 my-1">{game.scoreHome}</p>
                  <div className="flex justify-center space-x-1 mb-2">
                    <button onClick={() => bumpScore('home', -1)} className="text-xs text-slate-400 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">-</button>
                    <button onClick={() => bumpScore('home', 1)} className="text-xs text-slate-200 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">+</button>
                  </div>
                  <div className="flex flex-col items-center">
                    <FoulSquares count={getTeamFoulsForPeriod(game.period)} />
                  </div>
                </div>

                <div className="order-2 border-x border-slate-800 px-2">
                  <div className="flex items-center justify-center space-x-2">
                    <button onClick={() => changePeriod(game.period - 1)} className="w-5 h-5 rounded-full bg-slate-800 text-amber-400 font-black text-xs border border-amber-500/30">-</button>
                    <span className="bg-slate-800 text-amber-400 border border-amber-500/30 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">
                      {getPeriodLabel(game.period, game.config.periodCount)}
                    </span>
                    <button
                      onClick={() => changePeriod(game.period + 1)}
                      disabled={atLastPeriod && !canStartOvertime}
                      title={atLastPeriod && !canStartOvertime ? (overtimeAllowed ? "Prolongation possible seulement en cas d'égalité" : 'Pas de prolongation en dessous de U13') : undefined}
                      className="w-5 h-5 rounded-full bg-slate-800 text-amber-400 font-black text-xs border border-amber-500/30 disabled:opacity-30"
                    >+</button>
                  </div>
                  {canStartOvertime && game.scoreHome + game.scoreAway > 0 && (
                    <p className="text-[9px] font-bold text-amber-400 mt-1">Égalité : + pour OT{game.period - game.config.periodCount + 1}</p>
                  )}
                  {isEditingClock ? (
                    <input
                      type="text"
                      autoFocus
                      value={clockEditValue}
                      onChange={e => setClockEditValue(e.target.value)}
                      onBlur={commitClockEdit}
                      onKeyDown={e => { if (e.key === 'Enter') commitClockEdit(); if (e.key === 'Escape') setIsEditingClock(false); }}
                      placeholder="mm:ss"
                      className="text-3xl font-mono font-bold my-1 text-white bg-slate-800 border border-amber-500 rounded-lg w-28 text-center focus:outline-none"
                    />
                  ) : (
                    <p onDoubleClick={startEditingClock} title="Double-clic pour corriger le chrono" className="text-3xl font-mono font-bold my-1 text-white cursor-pointer select-none">{formatTime(game.clockSeconds)}</p>
                  )}
                  <div className="flex justify-center space-x-1">
                    <button onClick={() => setGame({...game, isClockRunning: !game.isClockRunning})} className={`text-[10px] font-extrabold px-3 py-1 rounded-lg transition ${game.isClockRunning ? 'bg-rose-600' : 'bg-emerald-600'}`}>{game.isClockRunning ? 'PAUSE' : 'START'}</button>
                    <button onClick={() => setConfirmResetPeriod(true)} className="text-[10px] font-extrabold px-2 py-1 bg-slate-800 text-slate-400 rounded-lg">RESET</button>
                  </div>
                </div>

                <div className={`flex flex-col items-center ${homeAway === 'DOMICILE' ? 'order-3' : 'order-1'}`}>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{matchConfig.teamAway || (homeAway === 'DOMICILE' ? 'EXTÉRIEUR' : 'DOMICILE')}</p>
                  <p className="text-4xl font-black text-slate-300 my-1">{game.scoreAway}</p>
                  <div className="flex justify-center space-x-1 mb-2">
                    <button onClick={() => bumpScore('away', -1)} className="text-xs text-slate-400 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">-</button>
                    <button onClick={() => bumpScore('away', 1)} className="text-xs text-slate-200 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">+</button>
                  </div>
                  {/* Incrémentation basée sur les Fautes Subies par notre équipe */}
                  <div className="flex flex-col items-center">
                    <FoulSquares count={getOpponentFoulsForPeriod(game.period)} />
                  </div>
                </div>
              </div>
              {Object.keys(game.scoreByPeriod).length > 0 && (
                <div className="flex justify-center flex-wrap gap-x-3 gap-y-1 pt-3 mt-3 border-t border-slate-800">
                  {Object.keys(game.scoreByPeriod).map(Number).sort((a, b) => a - b).map(p => (
                    <span key={p} className="text-[10px] text-slate-400 font-bold">
                      {getPeriodLabel(p, game.config.periodCount)} <span className="text-slate-200">{game.scoreByPeriod[p].home}-{game.scoreByPeriod[p].away}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-4 rounded-3xl shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Joueuses sur le terrain</h3>
                <button
                  onClick={() => {
                    if (isSubbing) { setIsSubbing(false); setSelectedOutIds([]); setSelectedInIds([]); }
                    else { setSelectedPlayerId(null); setIsSubbing(true); }
                  }}
                  disabled={!isSubbing && availableBenchPlayers.length === 0}
                  title="Faire un ou plusieurs changements"
                  className={`px-3 py-1 rounded-full text-[11px] font-black tracking-wide border transition disabled:opacity-40 ${isSubbing ? 'bg-indigo-500 border-indigo-300 text-white shadow' : 'bg-indigo-600/80 hover:bg-indigo-600 border-indigo-400/30 text-white'}`}
                >🔄 CHANGEMENTS</button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {game.matchRoster.length === 0 ? (
                  Array.from({ length: 5 }, (_, i) => i + 1).map(n => (
                    <div key={n} className="flex flex-col items-center p-2 rounded-2xl border border-dashed border-slate-700/80 text-slate-600">
                      <span className="text-lg font-black">#</span>
                      <span className="text-[10px] font-bold truncate max-w-full">Joueuse {n}</span>
                    </div>
                  ))
                ) : (
                  game.matchRoster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => {
                    const isSelected = selectedPlayerId === p.id;
                    const fouls = getFoulsCount(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPlayerId(isSelected ? null : p.id)}
                        className={`flex flex-col items-center p-2 rounded-2xl border transition bg-slate-800/90 hover:bg-slate-700/80 ${isSelected ? 'border-amber-400 ring-2 ring-amber-400 shadow-lg scale-105' : 'border-slate-700/80'}`}
                      >
                        <span className={`text-lg font-black ${isSelected ? 'text-amber-400' : 'text-white'}`}>#{p.number}</span>
                        <span className={`text-[10px] font-bold truncate max-w-full ${isSelected ? 'text-amber-400' : 'text-white'}`}>{getShortDisplayName(p, game.matchRoster)}</span>
                        <div className="mt-1">
                          <FoulSquares count={fouls} size="small" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {!isSubbing && (
              <div className={`bg-slate-900/95 backdrop-blur-md border-2 p-4 rounded-3xl shadow-2xl text-white space-y-4 transition ${selectedPlayer ? 'border-amber-500' : 'border-slate-700 opacity-60 pointer-events-none'}`}>
                <div className="flex items-center border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2 shrink-0">
                    {selectedPlayer ? (
                      <>
                        <span className="bg-amber-500 text-slate-950 px-2 py-0.5 rounded-lg font-black text-sm">#{panelPlayer.number}</span>
                        <span className="font-bold text-sm text-amber-400">{getShortDisplayName(panelPlayer, game.matchRoster)}</span>
                      </>
                    ) : (
                      <span className="font-bold text-sm text-slate-400">Touchez une joueuse</span>
                    )}
                  </div>
                  <div className="flex-1 flex justify-center px-3 py-1">
                    {(() => {
                      const s = getPlayerStats(panelPlayer.id, 'ALL');
                      const cols: [string, string | number][] = [
                        ['PTS', s.points],
                        ['2PTS', `${s.pts2Made}/${s.pts2Att}`],
                        ['3PTS', `${s.pts3Made}/${s.pts3Att}`],
                        ['LF', `${s.ftMade}/${s.ftAttempted}`],
                        ['REB O', s.rebOff],
                        ['REB D', s.rebDef],
                        ['AST', s.assists],
                        ['FT', s.fouls],
                        ['FS', s.foulsDrawn],
                        ['Tps', formatTime(s.totalSecs)],
                      ];
                      return (
                        <div className="flex flex-wrap justify-center items-end gap-x-3 gap-y-2">
                          {cols.map(([label, value]) => (
                            <div key={label} className="flex flex-col items-center leading-tight">
                              <span className="text-[8px] text-slate-500 font-bold uppercase">{label}</span>
                              <span className="text-[11px] text-slate-200 font-bold">{value}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center space-x-1 shrink-0">
                    <button
                      onClick={() => { const last = getLastPlayerAction(panelPlayer.id); if (last) setActionToUndo(last); }}
                      disabled={!getLastPlayerAction(panelPlayer.id)}
                      title="Supprimer la dernière action enregistrée"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-400 disabled:opacity-30 disabled:hover:bg-slate-800 transition"
                    >🧹</button>
                  </div>
                </div>

                {actionToUndo && (
                  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => setActionToUndo(null)}>
                    <div className="bg-slate-900 border border-rose-600/60 rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                      <h3 className="text-sm font-bold text-rose-400">Supprimer cette action ?</h3>
                      <p className="text-xs text-slate-300">
                        <span className="font-bold text-white">{getPeriodLabel(actionToUndo.period, game.config.periodCount)} - {actionToUndo.clockTime}</span> : {actionToUndo.actionType} pour <span className="font-bold text-white">#{panelPlayer.number} {getShortDisplayName(panelPlayer, game.matchRoster)}</span> sera retirée de l'historique. Cette action est irréversible.
                      </p>
                      <div className="flex space-x-2">
                        <button onClick={() => setActionToUndo(null)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-sm transition">Annuler</button>
                        <button onClick={handleConfirmUndo} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-sm transition">Supprimer</button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/60 p-2.5 rounded-2xl border border-slate-700/60 space-y-2">
                    <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Tir à 2 Points</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => recordEvent('TIR 2PTS RÉUSSI', panelPlayer.id, 2)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 rounded-xl text-xs shadow">🟢 Réussi (+2)</button>
                      <button onClick={() => recordEvent('TIR 2PTS Manqué', panelPlayer.id, 0)} className="bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-xs">🔴 Manqué</button>
                    </div>
                  </div>

                  <div className="bg-slate-800/60 p-2.5 rounded-2xl border border-slate-700/60 space-y-2">
                    <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Tir à 3 Points</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => recordEvent('TIR 3PTS RÉUSSI', panelPlayer.id, 3)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 rounded-xl text-xs shadow">🟢 Réussi (+3)</button>
                      <button onClick={() => recordEvent('TIR 3PTS Manqué', panelPlayer.id, 0)} className="bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-xs">🔴 Manqué</button>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/60 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Lancers Francs</span>
                    {ftAttempts.some(v => v !== null) && (
                      <button onClick={() => setFtAttempts([null, null, null])} className="text-[10px] text-slate-400 hover:text-white underline font-bold uppercase">Réinitialiser LF</button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map(index => {
                      const isEnabled = index === 0 || ftAttempts[index - 1] !== null;
                      return (
                        <div key={index} className={`flex flex-col bg-slate-900/60 p-1.5 rounded-xl border border-slate-700 space-y-1 transition ${!isEnabled ? 'opacity-30 pointer-events-none' : ''}`}>
                          <span className="text-[10px] font-bold text-slate-400 text-center">LF {index + 1}</span>
                          <button
                            disabled={!isEnabled}
                            onClick={() => {
                              const updated = [...ftAttempts] as [boolean | null, boolean | null, boolean | null];
                              updated[index] = true;
                              setFtAttempts(updated);
                            }}
                            className={`py-1.5 rounded-lg text-[10px] font-black transition ${ftAttempts[index] === true ? 'bg-emerald-500 text-white shadow' : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40'}`}
                          >🟢 Réussi (1 pt)</button>
                          <button
                            disabled={!isEnabled}
                            onClick={() => {
                              const updated = [...ftAttempts] as [boolean | null, boolean | null, boolean | null];
                              updated[index] = false;
                              setFtAttempts(updated);
                            }}
                            className={`py-1.5 rounded-lg text-[10px] font-black transition ${ftAttempts[index] === false ? 'bg-rose-500 text-white shadow' : 'bg-rose-600/20 text-rose-300 hover:bg-rose-600/40'}`}
                          >🔴 Manqué</button>
                        </div>
                      );
                    })}
                  </div>
                  {ftAttempts.some(v => v !== null) && (
                    <button onClick={handleFreeThrowsSubmit} className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-xl text-xs transition">Valider les lancers francs</button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button onClick={() => recordEvent('REBOND OFFENSIF', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🗑️ Rebond Off.</button>
                  <button onClick={() => recordEvent('REBOND DÉFENSIF', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🛡️ Rebond Déf.</button>
                  <button onClick={() => recordEvent('PASSE DÉCISIVE', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🎯 Assist</button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button onClick={() => recordEvent('INTERCEPTION', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">✋ Interception</button>
                  <button onClick={() => recordEvent('PERTE DE BALLE', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">💨 Perte de balles</button>
                  <button onClick={() => recordEvent('CONTRE', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🚫 Contre</button>
                  <button onClick={() => recordEvent('CONTRE SUBI', panelPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🧱 Contre subi</button>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 border-t border-slate-800 pt-2">
                  <button onClick={() => recordEvent('FAUTE SUBIE', panelPlayer.id)} className="bg-blue-950/60 hover:bg-blue-900 border border-blue-800/80 text-blue-200 text-xs font-bold py-2 rounded-xl">🛡️ Faute Subie</button>
                  <button onClick={() => recordEvent('FAUTE PERSONNELLE', panelPlayer.id)} className="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold py-2 rounded-xl">⚠️ Faute Perso</button>
                  <button onClick={() => recordEvent('FAUTE TECHNIQUE', panelPlayer.id)} className="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold py-2 rounded-xl">⚠️ Faute Tech.</button>
                  <button onClick={() => recordEvent('FAUTE ANTISPORTIVE', panelPlayer.id)} className="bg-rose-950/80 hover:bg-rose-900 border border-rose-700 text-rose-100 text-xs font-bold py-2 rounded-xl">⚠️ Faute Antisp.</button>
                  <button onClick={() => recordEvent('FAUTE DISQUALIFIANTE', panelPlayer.id)} className="bg-rose-900 hover:bg-rose-800 text-white text-xs font-bold py-2 rounded-xl">🟥 Disqual.</button>
                </div>
              </div>
            )}

            {isSubbing && (
              <div className="bg-slate-900/95 backdrop-blur-md border border-indigo-500/50 p-4 rounded-3xl shadow-xl space-y-4 text-white">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Changements de joueuses</h3>
                  <button onClick={() => { setIsSubbing(false); setSelectedOutIds([]); setSelectedInIds([]); }} className="text-xs text-rose-400 font-bold">ANNULER</button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-rose-400 font-bold mb-2">1. Sortie(s) ({selectedOutIds.length}) :</p>
                    <div className="space-y-2">
                      {game.matchRoster.filter(p => game.onCourtPlayerIds.includes(p.id) || selectedOutIds.includes(p.id)).map(p => {
                        const isSelected = selectedOutIds.includes(p.id);
                        const fouls = getFoulsCount(p.id);
                        const isFouledOut = fouls >= 5;
                        return (
                          <button key={p.id} disabled={isFouledOut} onClick={() => toggleSelectOut(p.id)} className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition ${isFouledOut ? 'bg-rose-950/80 border-rose-600 text-rose-200 cursor-not-allowed' : isSelected ? 'bg-rose-500/20 border-rose-500 text-white font-bold' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                            <div className="flex items-center space-x-2 truncate">
                              <input type="checkbox" checked={isSelected} readOnly disabled={isFouledOut} className="accent-rose-500" />
                              <span className="truncate">#{p.number} {getShortDisplayName(p, game.matchRoster)}</span>
                            </div>
                            {isFouledOut ? (
                              <span className="text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded font-black tracking-wider">EXCLUE</span>
                            ) : (
                              <FoulSquares count={fouls} size="small" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-emerald-400 font-bold mb-2">2. Entrée(s) ({selectedInIds.length}) :</p>
                    <div className="space-y-2">
                      {game.matchRoster.filter(p => !game.onCourtPlayerIds.includes(p.id) && !selectedOutIds.includes(p.id)).map(p => {
                        const fouls = getFoulsCount(p.id);
                        const isFouledOut = fouls >= 5;
                        const isSelected = selectedInIds.includes(p.id);
                        return (
                          <button key={p.id} disabled={isFouledOut} onClick={() => toggleSelectIn(p.id)} className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition ${isFouledOut ? 'bg-slate-900/60 border-slate-800 text-slate-600 cursor-not-allowed' : isSelected ? 'bg-emerald-500/20 border-emerald-500 text-white font-bold' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                            <div className="flex items-center space-x-2 truncate">
                              {!isFouledOut && <input type="checkbox" checked={isSelected} readOnly className="accent-emerald-500" />}
                              <span className="truncate">#{p.number} {getShortDisplayName(p, game.matchRoster)}</span>
                            </div>
                            {isFouledOut ? (
                              <span className="text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded font-black tracking-wider">EXCLUE</span>
                            ) : (
                              <FoulSquares count={fouls} size="small" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedInIds.length > 0 && selectedOutIds.length === selectedInIds.length && (
                    <button onClick={validateSubstitutions} className="col-span-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl shadow-lg transition">Valider le(s) remplacement(s)</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'STATS' && (
          <div className="bg-slate-900/90 text-white p-4 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-amber-400">Statistiques Joueuses</h2>
              <div className="flex space-x-1 bg-slate-800 p-1 rounded-xl text-xs font-bold">
                <button onClick={() => setSelectedPeriodFilter('ALL')} className={`px-2.5 py-1 rounded-lg transition ${selectedPeriodFilter === 'ALL' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'}`}>TOUT</button>
                {Array.from({ length: lastPeriodShown }, (_, i) => i + 1).map(pNum => (
                  <button key={pNum} onClick={() => setSelectedPeriodFilter(pNum)} className={`px-2.5 py-1 rounded-lg transition ${selectedPeriodFilter === pNum ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'}`}>
                    {getPeriodLabel(pNum, game.config.periodCount)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/mode-emploi-teamstats.pdf"
                download="TeamStats - Mode d'emploi.pdf"
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow transition"
              >📘 Mode d'emploi (PDF)</a>
              <button
                onClick={handleExportStatsPdf}
                disabled={isExportingPdf}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-bold shadow transition"
              >{isExportingPdf ? '⏳ Génération…' : '📄 Statistiques (PDF)'}</button>
              {pdfError && <span className="text-[10px] text-rose-400 break-words">Échec du PDF : {pdfError}</span>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-bold">
                    <th className="py-2 px-1">#</th>
                    <th className="py-2 px-1">Joueuse</th>
                    <th className="py-2 px-1 text-center">PTS</th>
                    <th className="py-2 px-1 text-center">2PTS</th>
                    <th className="py-2 px-1 text-center">3PTS</th>
                    <th className="py-2 px-1 text-center">LF</th>
                    <th className="py-2 px-1 text-center">REB O</th>
                    <th className="py-2 px-1 text-center">REB D</th>
                    <th className="py-2 px-1 text-center">AST</th>
                    <th className="py-2 px-1 text-center" title="Interceptions">INT</th>
                    <th className="py-2 px-1 text-center" title="Pertes de balle">BP</th>
                    <th className="py-2 px-1 text-center" title="Contres">CT</th>
                    <th className="py-2 px-1 text-center" title="Contres subis">CTS</th>
                    <th className="py-2 px-1 text-center">FT</th>
                    <th className="py-2 px-1 text-center text-blue-400">FS</th>
                    <th className="py-2 px-1 text-center text-emerald-400" title="Évaluation = (points + rebonds + passes + interceptions + contres + fautes subies) - (tirs et lancers francs manqués + balles perdues + fautes commises + contres subis)">ÉVAL</th>
                    <th className="py-2 px-1 text-right">Tps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-semibold">
                  {game.matchRoster.map(p => {
                    const st = getPlayerStats(p.id, selectedPeriodFilter);
                    return (
                      <tr key={p.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-1 font-black text-amber-400">#{p.number}</td>
                        <td className="py-2.5 px-1 font-bold text-slate-200">{getShortDisplayName(p, game.matchRoster)}</td>
                        <td className="py-2.5 px-1 text-center font-black text-amber-300">{st.points}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.pts2Made}/{st.pts2Att}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.pts3Made}/{st.pts3Att}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.ftMade}/{st.ftAttempted}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.rebOff}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.rebDef}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.assists}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.steals}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.turnovers}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.blocks}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.blocksAgainst}</td>
                        <td className="py-2.5 px-1 text-center text-rose-400 font-bold">{st.fouls}</td>
                        <td className="py-2.5 px-1 text-center text-blue-400 font-bold">{st.foulsDrawn}</td>
                        <td className={`py-2.5 px-1 text-center font-black ${st.evaluation < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{st.evaluation}</td>
                        <td className="py-2.5 px-1 text-right font-mono text-slate-400">{formatTime(st.totalSecs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'LOGS' && (
          <div className="bg-slate-900/90 text-white p-4 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-amber-400">Historique du Match</h2>
              <button onClick={handleResetAll} title="Efface actions, score, temps de jeu et chrono de ce match" className="text-[11px] font-bold text-rose-300 hover:text-white bg-rose-950/60 hover:bg-rose-700 border border-rose-800 px-2.5 py-1 rounded-lg transition">Tout remettre à zéro</button>
            </div>
            {(() => {
              const visibleEvents = game.events.filter(ev => !ev.actionType.startsWith('ETAT:'));
              return visibleEvents.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Aucun événement enregistré.</p>
              ) : (
                <div className="space-y-2">
                  {visibleEvents.map(ev => {
                    const player = game.matchRoster.find(p => p.id === ev.playerId);
                    return (
                      <div key={ev.id} className="flex justify-between items-center bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/50 text-xs">
                        <div className="flex items-center space-x-2.5">
                          <span className="bg-slate-700 text-amber-400 font-black px-2 py-0.5 rounded text-[10px]">
                            {getPeriodLabel(ev.period, game.config.periodCount)} - {ev.clockTime}
                          </span>
                          <span className="font-bold text-white">{player ? `#${player.number} ${getShortDisplayName(player, game.matchRoster)}` : 'Équipe'}</span>
                          <span className="text-slate-300">{ev.actionType}</span>
                        </div>
                        <button onClick={() => deleteEvent(ev.id)} className="text-rose-400 hover:text-rose-300 font-bold px-2 py-1 bg-rose-950/50 rounded-lg">Supprimer</button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONNEXION : page affichée avant toute l'application.
// Profils : "admin" (toutes les équipes) et "analyst" (équipes de team_access uniquement).
// La vraie protection est dans Supabase (RLS, voir sql/security_01_profiles_and_rls.sql) :
// cette page ne fait que demander un compte, la base refuse tout à qui n'est pas connecté.
// ---------------------------------------------------------------------------
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(/invalid login credentials/i.test(signInError.message) ? 'E-mail ou mot de passe incorrect.' : signInError.message);
      setSubmitting(false);
    }
    // En cas de succès, la passerelle détecte la session et affiche l'application.
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-3xl shadow-2xl p-6 space-y-4 text-white">
        <div className="flex flex-col items-center space-y-2">
          <img src="/logo-stats.png" alt="Statistiques basket" className="w-24 h-24 rounded-2xl object-cover" />
          <h1 className="font-extrabold tracking-wider text-amber-500 text-lg uppercase">Olympic Sathonay</h1>
          <p className="text-xs text-slate-400">Suivi de match et statistiques - connexion</p>
        </div>

        <div>
          <label htmlFor="login-email" className="block text-xs font-semibold text-slate-400 mb-1">Adresse e-mail</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm font-bold text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-xs font-semibold text-slate-400 mb-1">Mot de passe</label>
          <div className="flex space-x-2">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm font-bold text-white focus:outline-none focus:border-amber-500"
            />
            <button type="button" onClick={() => setShowPassword(v => !v)} className="shrink-0 px-3 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300 hover:text-white">
              {showPassword ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-rose-400 break-words">{error}</p>}

        <button type="submit" disabled={submitting} className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl shadow-lg transition">
          {submitting ? 'Connexion...' : 'Se connecter'}
        </button>
        <p className="text-[10px] text-slate-500 text-center">Les comptes sont créés par l'administrateur.</p>
      </form>
    </div>
  );
}

function CenteredMessage({ title, children, onSignOut }: { title: string; children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-slate-900/90 border border-white/10 rounded-3xl shadow-2xl p-6 space-y-3 text-white text-center">
        <h1 className="font-bold text-amber-400">{title}</h1>
        <div className="text-xs text-slate-300 break-words">{children}</div>
        {onSignOut && (
          <button onClick={onSignOut} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-bold py-2.5 rounded-xl transition">Se déconnecter</button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<'loading' | 'signed_out' | 'no_profile' | 'error' | 'ready'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  // Hors connexion, on laisse entrer un compte déjà connu de l'appareil (profil gardé en mémoire locale).
  const [offlineIdentity, setOfflineIdentity] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const offlineIdentityRef = useRef(false);

  useEffect(() => {
    let active = true;
    const setOffline = (value: boolean) => {
      offlineIdentityRef.current = value;
      setOfflineIdentity(value);
    };

    // Lit le profil (admin / analyst) du compte connecté ; sans profil, pas d'accès.
    const resolveSession = async (s: any) => {
      if (!active) return;
      if (!s) {
        // Sans réseau, la session ne peut pas être renouvelée : on garde l'accès pour le compte déjà connu sur cet appareil.
        const known = lsRead<any>(LS_OFFLINE_USER, null);
        if (known && typeof navigator !== 'undefined' && !navigator.onLine) {
          setSession({ user: { id: known.userId, email: known.email } });
          setRole(known.role);
          setOffline(true);
          setStatus('ready');
          return;
        }
        setSession(null);
        setRole(null);
        setOffline(false);
        setNeedsReauth(false);
        setStatus('signed_out');
        return;
      }
      setSession(s);
      const { data, error } = await supabase.from('app_profiles').select('role').eq('user_id', s.user.id).maybeSingle();
      if (!active) return;
      if (error) {
        const known = lsRead<any>(LS_OFFLINE_USER, null);
        if (isNetworkError(error) && known && known.userId === s.user.id) {
          setRole(known.role);
          setOffline(true);
          setStatus('ready');
          return;
        }
        setErrorMessage(error.message);
        setStatus('error');
      } else if (data?.role === 'admin' || data?.role === 'analyst') {
        lsWrite(LS_OFFLINE_USER, { userId: s.user.id, email: s.user.email || '', role: data.role });
        setRole(data.role);
        setOffline(false);
        setNeedsReauth(false);
        setStatus('ready');
      } else {
        lsRemove(LS_OFFLINE_USER);
        setRole(null);
        setStatus('no_profile');
      }
    };

    supabase.auth.getSession().then(({ data }: any) => resolveSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event: any, s: any) => {
      // Reporté d'un tick : on n'appelle pas Supabase directement depuis ce rappel (risque de blocage).
      setTimeout(() => { void resolveSession(s); }, 0);
    });

    // Retour du réseau alors qu'on est entré sur le profil mémorisé : on retente de retrouver la vraie session.
    const handleOnline = async () => {
      if (!offlineIdentityRef.current) return;
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) await resolveSession(data.session);
      else setNeedsReauth(true);
    };
    window.addEventListener('online', handleOnline);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const signOut = async () => {
    const pending = readPending().filter(i => session && i.userId === session.user.id).length;
    if (pending > 0 && !window.confirm(`${pending} match${pending > 1 ? 's' : ''} ${pending > 1 ? 'ne sont pas encore envoyés' : "n'est pas encore envoyé"} en base. Se déconnecter maintenant empêchera l'envoi tant que vous ne serez pas reconnecté. Continuer ?`)) return;
    lsRemove(LS_OFFLINE_USER);
    await supabase.auth.signOut({ scope: 'local' });
    // La déconnexion locale ne dépend pas du réseau : on affiche la connexion tout de suite.
    setSession(null);
    setRole(null);
    setNeedsReauth(false);
    offlineIdentityRef.current = false;
    setOfflineIdentity(false);
    setStatus('signed_out');
  };

  if (status === 'loading') return <CenteredMessage title="Chargement...">Vérification de la connexion.</CenteredMessage>;
  if (status === 'signed_out' || !session) return <LoginScreen />;
  if (status === 'no_profile') {
    return (
      <CenteredMessage title="Accès non autorisé" onSignOut={signOut}>
        Votre compte ({session.user.email}) n'a pas encore de profil. Demandez à l'administrateur de vous donner accès.
      </CenteredMessage>
    );
  }
  if (status === 'error' || !role) {
    return (
      <CenteredMessage title="Connexion impossible" onSignOut={signOut}>
        Le profil n'a pas pu être lu : {errorMessage || 'erreur inconnue'}. Vérifiez que sql/security_01_profiles_and_rls.sql a été exécuté.
      </CenteredMessage>
    );
  }
  return (
    <TeamStatsApp
      key={session.user.id}
      userId={session.user.id}
      userEmail={session.user.email || ''}
      role={role}
      onSignOut={signOut}
      needsReauth={needsReauth && offlineIdentity}
      onReauth={signOut}
    />
  );
}
