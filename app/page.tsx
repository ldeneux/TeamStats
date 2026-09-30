'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Configuration Supabase
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://votre-projet.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'votre-cle-anon';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'multisports' }
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

const sortPlayersAlpha = (players: Player[]) => [...players].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

export default function App() {
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
  const [pickerTypeFilter, setPickerTypeFilter] = useState<'ALL' | 'OFFICIEL' | 'AMICAL'>('OFFICIEL');
  const [matchToDelete, setMatchToDelete] = useState<any | null>(null);
  const [isDeletingMatch, setIsDeletingMatch] = useState(false);
  const [actionToUndo, setActionToUndo] = useState<GameEvent | null>(null);
  const [currentMatchDbId, setCurrentMatchDbId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState('');
  const [isEditingClock, setIsEditingClock] = useState(false);
  const [confirmResetPeriod, setConfirmResetPeriod] = useState(false);
  const [startingFiveByPeriod, setStartingFiveByPeriod] = useState<{ [period: number]: string[] }>({});
  const [clockEditValue, setClockEditValue] = useState('');

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
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingTeams(false);
    }
  };

  useEffect(() => {
    fetchTeamsFromSupabase();
    (async () => {
      try {
        const { data } = await supabase.from('basketball_clubs').select('display_name').order('display_name');
        if (data) setClubNames(Array.from(new Set(data.map((c: any) => c.display_name).filter(Boolean))));
      } catch (err) {
        console.error(err);
      }
    })();
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
        setFfbbLookupError(error.message);
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
    setPickerSeasonFilter(getSeasonLabel(new Date().toISOString().split('T')[0]));
    try {
      const { data, error } = await supabase
        .from('stats_matches')
        .select('id, ffbb_match_id, team_home, team_away, match_date, score_home, score_away, period_count, period_minutes, current_period, current_timer, created_at')
        .order('match_date', { ascending: false })
        .limit(200);
      if (!error && data) setExistingMatches(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingExistingMatches(false);
    }
  };

  // SUPPRIMER DÉFINITIVEMENT UN MATCH (infos + événements + statistiques)
  const handleDeleteMatch = async () => {
    if (!matchToDelete) return;
    setIsDeletingMatch(true);
    try {
      await supabase.from('stats_match_events').delete().eq('match_id', matchToDelete.id);
      await supabase.from('stats_player_game_stats').delete().eq('match_id', matchToDelete.id);
      await supabase.from('stats_matches').delete().eq('id', matchToDelete.id);
      setExistingMatches(prev => prev.filter(m => m.id !== matchToDelete.id));
      if (currentMatchDbId === matchToDelete.id) setCurrentMatchDbId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeletingMatch(false);
      setMatchToDelete(null);
    }
  };

  // CHARGER UN MATCH EXISTANT (infos + statistiques) DEPUIS SUPABASE
  const handleSelectExistingMatch = async (matchRow: any) => {
    try {
      const { data: eventsData } = await supabase
        .from('stats_match_events')
        .select('*')
        .eq('match_id', matchRow.id)
        .order('created_at', { ascending: true });

      const { data: statsData } = await supabase
        .from('stats_player_game_stats')
        .select('*')
        .eq('match_id', matchRow.id);

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
        period: parseInt(String(matchRow.current_period || 'Q1').replace(/\D/g, ''), 10) || 1,
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
    } catch (err) {
      console.error(err);
    }
  };

  // ENREGISTRER LE MATCH EN COURS (infos + statistiques) DANS SUPABASE
  const handleSaveMatch = async () => {
    setSaveStatus('saving');
    setSaveErrorMessage('');
    const check = (res: { error: any }, step: string) => {
      if (res.error) throw new Error(`${step} : ${res.error.message}`);
    };
    try {
      let ffbbId = matchConfig.ffbbMatchId.trim();
      if (!ffbbId) {
        ffbbId = `AMICAL-${Date.now()}`;
        setMatchConfig(prev => ({ ...prev, ffbbMatchId: ffbbId }));
      }

      const { data: savedMatch, error: matchErr } = await supabase
        .from('stats_matches')
        .upsert({
          ffbb_match_id: ffbbId,
          match_date: matchConfig.matchDate,
          // En base, "home" = vrai domicile (notre équipe si DOM, l'adversaire si EXT).
          // On part toujours des valeurs en direct du formulaire (matchConfig), jamais de
          // l'instantané game.config figé au dernier "Démarrer / Mettre à jour le match" :
          // sinon un nom d'équipe ou une date corrigés après coup ne seraient pas sauvegardés.
          team_home: homeAway === 'DOMICILE' ? matchConfig.teamHome : matchConfig.teamAway,
          team_away: homeAway === 'DOMICILE' ? matchConfig.teamAway : matchConfig.teamHome,
          score_home: homeAway === 'DOMICILE' ? game.scoreHome : game.scoreAway,
          score_away: homeAway === 'DOMICILE' ? game.scoreAway : game.scoreHome,
          period_count: matchConfig.periodCount,
          period_minutes: matchConfig.periodMinutes,
          current_period: getPeriodLabel(game.period, game.config.periodCount),
          current_timer: game.clockSeconds
        }, { onConflict: 'ffbb_match_id' })
        .select()
        .single();

      if (matchErr || !savedMatch) throw new Error(`stats_matches : ${matchErr?.message || 'aucune ligne renvoyée'}`);
      const matchId = savedMatch.id;
      setCurrentMatchDbId(matchId);

      check(await supabase.from('stats_match_events').delete().eq('match_id', matchId), 'stats_match_events (suppression)');
      if (game.events.length > 0) {
        check(await supabase.from('stats_match_events').insert(
          game.events.map(ev => ({
            match_id: matchId,
            period: ev.period,
            clock_time: ev.clockTime,
            timestamp_str: ev.timestamp,
            player_id: ev.playerId,
            action_type: ev.actionType
          }))
        ), 'stats_match_events (événements)');
      }
      if (game.onCourtPlayerIds.length > 0) {
        check(await supabase.from('stats_match_events').insert(
          game.onCourtPlayerIds.map(playerId => ({
            match_id: matchId,
            period: game.period,
            clock_time: formatTime(game.clockSeconds),
            timestamp_str: new Date().toLocaleTimeString(),
            player_id: playerId,
            action_type: 'ETAT:SUR_TERRAIN'
          }))
        ), 'stats_match_events (joueuses sur le terrain)');
      }
      const scorePeriodEntries = Object.entries(game.scoreByPeriod);
      if (scorePeriodEntries.length > 0) {
        check(await supabase.from('stats_match_events').insert(
          scorePeriodEntries.map(([period, s]) => {
            // Même convention "vrai domicile/extérieur" que team_home/score_home ci-dessus.
            const dbHome = homeAway === 'DOMICILE' ? s.home : s.away;
            const dbAway = homeAway === 'DOMICILE' ? s.away : s.home;
            return {
              match_id: matchId,
              period: Number(period),
              clock_time: formatTime(game.clockSeconds),
              timestamp_str: new Date().toLocaleTimeString(),
              player_id: '',
              action_type: `ETAT:SCORE_PERIODE:${dbHome}-${dbAway}`
            };
          })
        ), 'stats_match_events (score par période)');
      }

      check(await supabase.from('stats_player_game_stats').delete().eq('match_id', matchId), 'stats_player_game_stats (suppression)');
      if (game.matchRoster.length > 0) {
        check(await supabase.from('stats_player_game_stats').insert(
          game.matchRoster.map(p => {
            const st = getPlayerStats(p.id, 'ALL');
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
              fouls: st.fouls,
              fouls_drawn: st.foulsDrawn,
              playing_time_seconds: st.totalSecs
            };
          })
        ), 'stats_player_game_stats (totaux)');
      }

      // Statistiques par joueuse ET par période (table dédiée stats_player_period_stats)
      const maxPeriod = Math.max(
        game.period,
        ...game.events.map(e => e.period),
        ...Object.values(playingTime).flatMap(pt => Object.keys(pt).map(Number))
      );
      const periodRows: any[] = [];
      game.matchRoster.forEach(p => {
        for (let per = 1; per <= maxPeriod; per++) {
          const st = getPlayerStats(p.id, per);
          periodRows.push({
            match_id: matchId,
            player_id: p.id,
            player_number: p.number,
            player_name: p.name,
            period: per,
            is_starter: (startingFiveByPeriod[per] || []).includes(p.id),
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
            fouls: st.fouls,
            fouls_drawn: st.foulsDrawn
          });
        }
      });
      check(await supabase.from('stats_player_period_stats').delete().eq('match_id', matchId), 'stats_player_period_stats (suppression)');
      if (periodRows.length > 0) {
        check(await supabase.from('stats_player_period_stats').insert(periodRows), 'stats_player_period_stats (insertion)');
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err: any) {
      console.error(err);
      setSaveErrorMessage(err?.message || String(err));
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 15000);
    }
  };

  // SAUVEGARDE / MODIFICATION DANS SUPABASE
  const handleSaveTeamToSupabase = async () => {
    if (!newTeamName.trim()) return;
    setTeamSaveStatus('saving');

    try {
      let targetTeamId = selectedTeamId;

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
  const changePeriod = (newPeriod: number) => {
    const clamped = Math.min(game.config.periodCount, Math.max(1, newPeriod));
    setStartingFiveByPeriod(sf => (sf[clamped] ? sf : { ...sf, [clamped]: game.onCourtPlayerIds }));
    setGame(prev => ({ ...prev, period: clamped }));
  };

  // RÉINITIALISER LE QUART-TEMPS EN COURS : remet le chrono à fond et efface le temps de jeu
  // + les actions déjà enregistrées pour cette période précise .
  const handleConfirmResetPeriod = () => {
    const p = game.period;
    setGame(prev => ({
      ...prev,
      clockSeconds: prev.config.periodMinutes * 60,
      isClockRunning: false,
      events: prev.events.filter(e => e.period !== p)
    }));
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

  const recordEvent = (action: string, playerId: string, points = 0) => {    const newEvent: GameEvent = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      period: game.period,
      clockTime: formatTime(game.clockSeconds),
      actionType: action,
      playerId: playerId
    };

    let updatedOnCourt = [...game.onCourtPlayerIds];
    let alertFoul = false;

    if (action.includes('DISQUALIFIANTE')) {
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

  const getPlayerStats = (playerId: string, periodFilter: number | 'ALL') => {
    const eventsToAnalyze = game.events.filter(e => {
      const matchPlayer = e.playerId === playerId;
      const matchPeriod = periodFilter === 'ALL' ? true : e.period === periodFilter;
      return matchPlayer && matchPeriod;
    });

    let points = 0, fouls = 0, foulsDrawn = 0, ftMade = 0, ftAttempted = 0, pts2Made = 0, pts2Att = 0, pts3Made = 0, pts3Att = 0;
    let rebOff = 0, rebDef = 0, assists = 0;

    eventsToAnalyze.forEach(ev => {
      const act = ev.actionType;
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

    return { points, totalSecs, fouls, foulsDrawn, ftMade, ftAttempted, pts2Made, pts2Att, pts3Made, pts3Att, rebOff, rebDef, assists };
  };

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

  const availableSeasons = Array.from(new Set(existingMatches.map(m => getSeasonLabel(m.match_date)))).filter(Boolean).sort().reverse();
  const pickerTeamNames = Array.from(new Set(savedTeams.map(t => t.name)));
  const filteredExistingMatches = existingMatches.filter(m => {
    const isAmical = String(m.ffbb_match_id || '').startsWith('AMICAL-');
    if (pickerTypeFilter === 'OFFICIEL' && isAmical) return false;
    if (pickerTypeFilter === 'AMICAL' && !isAmical) return false;
    if (pickerTeamFilter !== 'ALL' && m.team_home !== pickerTeamFilter && m.team_away !== pickerTeamFilter) return false;
    if (pickerSeasonFilter !== 'ALL' && getSeasonLabel(m.match_date) !== pickerSeasonFilter) return false;
    return true;
  });

  return (
    <div className="max-w-3xl mx-auto min-h-screen pb-12 pt-4 px-2">
      <header className="bg-slate-900/90 backdrop-blur-md text-white rounded-2xl border border-slate-700/50 shadow-lg mb-4">
        <div className="flex justify-between items-center px-4 py-2.5">
          <div className="flex items-center space-x-2.5">
            <span className="font-extrabold tracking-wider text-amber-500 text-sm uppercase">Olympic Sathonay</span>
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
                saveStatus === 'error' ? 'bg-rose-600 text-white' :
                saveStatus === 'saving' ? 'bg-slate-700 text-slate-400' :
                'text-slate-400 hover:text-white'
              }`}
            >{saveStatus === 'saving' ? '⏳' : saveStatus === 'saved' ? '✅' : saveStatus === 'error' ? '⚠️' : '💾'}</button>
          </nav>
        </div>
        {saveStatus === 'error' && (
          <p className="text-center text-[10px] text-rose-400 pb-1 px-2 break-words">Échec de l'enregistrement : {saveErrorMessage || 'vérifie la connexion Supabase.'}</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-center text-[10px] text-emerald-400 pb-1">Match et statistiques enregistrés.</p>
        )}
      </header>

      <main>
        {activeTab === 'INIT' && (
          <div className="space-y-4">

            {/* 1. ÉQUIPES & JOUEUSES */}
            <div className="bg-slate-900/90 text-white p-6 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-amber-400 uppercase">Équipes &amp; Joueuses</h2>
                <button onClick={fetchTeamsFromSupabase} disabled={isLoadingTeams} className="text-xs text-slate-400 hover:text-white bg-slate-800 px-3 py-1 rounded-lg border border-slate-700">
                  {isLoadingTeams ? 'Chargement...' : '🔄 Rafraîchir'}
                </button>
              </div>

              <div className="flex items-end space-x-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Choisir une équipe</label>
                  <select value={selectedTeamId} onChange={e => handleLoadTeamFromSelect(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none">
                    <option value="">-- Créer une nouvelle équipe --</option>
                    {savedTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.roster.length} joueuses)</option>
                    ))}
                  </select>
                </div>
                <button onClick={() => setIsEditingTeamForm(v => !v)} title="Créer / modifier l'effectif de l'équipe" className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-xl border transition ${isEditingTeamForm ? 'bg-amber-600 border-amber-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}>✏️</button>
              </div>

              {(isEditingTeamForm || !selectedTeamId) && (
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

            {/* 2. MATCH */}
            <div className="bg-slate-900/90 text-white p-6 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-amber-400">Match</h2>
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
                    <button onClick={openFfbbPicker} title="Rechercher un match déjà enregistré" className="shrink-0 w-10 h-10 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 text-lg">🔍</button>
                  </div>
                  {ffbbLookupStatus === 'error' && (
                    <p className="text-[10px] text-rose-400 mt-1 break-words">{ffbbLookupError} (as-tu exécuté sql/ffbb_lookup.sql ?)</p>
                  )}
                </div>
              </div>
            </div>

            {/* 3. FEUILLE DE MATCH */}
            <div className="bg-slate-900/90 text-white p-6 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <h2 className="text-xl font-bold text-amber-400">Feuille de Match</h2>
                <span className={`text-xs font-black ${selectedMatchPlayerIds.length === 10 ? 'text-amber-400' : 'text-slate-400'}`}>{selectedMatchPlayerIds.length} / 10 max</span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {editingRoster.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Choisis ou crée une équipe ci-dessus pour constituer la feuille de match.</p>
                ) : (
                  editingRoster.map(p => {
                    const isSelected = selectedMatchPlayerIds.includes(p.id);
                    const matchNumber = matchNumbers[p.id] ?? p.number;
                    return (
                      <div key={p.id} className={`flex items-center justify-between p-2 rounded-xl border text-xs font-bold transition ${isSelected ? 'bg-amber-500/20 border-amber-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
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
                <h3 className="text-sm font-bold text-amber-400">Matchs déjà enregistrés</h3>
                <button onClick={() => setShowFfbbPicker(false)} className="text-xs text-slate-400 hover:text-white font-bold">Fermer ✖</button>
              </div>

              <div className="flex items-center bg-slate-800 border border-slate-700 rounded-full p-1 text-[10px] font-black w-fit">
                <button onClick={() => setPickerTypeFilter('OFFICIEL')} className={`px-2.5 py-1 rounded-full transition ${pickerTypeFilter === 'OFFICIEL' ? 'bg-amber-600 text-white shadow' : 'text-slate-400'}`}>OFFICIEL</button>
                <button onClick={() => setPickerTypeFilter('AMICAL')} className={`px-2.5 py-1 rounded-full transition ${pickerTypeFilter === 'AMICAL' ? 'bg-blue-600 text-white shadow' : 'text-slate-400'}`}>AMICAL</button>
                <button onClick={() => setPickerTypeFilter('ALL')} className={`px-2.5 py-1 rounded-full transition ${pickerTypeFilter === 'ALL' ? 'bg-slate-600 text-white shadow' : 'text-slate-400'}`}>TOUS</button>
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

              {isLoadingExistingMatches ? (
                <p className="text-xs text-slate-400 text-center py-4">Chargement...</p>
              ) : filteredExistingMatches.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Aucun match ne correspond à ces filtres.</p>
              ) : (
                <div className="space-y-2">
                  {filteredExistingMatches.map(m => (
                    <div key={m.id} className="w-full text-left p-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-amber-500 transition flex items-center space-x-2">
                      <button onClick={() => handleSelectExistingMatch(m)} className="flex-1 text-left min-w-0">
                        <div className="flex justify-between items-start gap-2 text-xs">
                          <span className="font-bold text-white break-words">{m.team_home} vs {m.team_away}</span>
                          <span className="font-bold text-slate-300 shrink-0">{m.score_home} - {m.score_away}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                          <span className="truncate">
                            {m.match_date ? new Date(m.match_date).toLocaleDateString('fr-FR') : 'Date inconnue'}
                            {' · '}
                            {String(m.ffbb_match_id || '').startsWith('AMICAL-') ? 'Amical' : `ID : ${m.ffbb_match_id}`}
                            {m.created_at && (
                              <span className="text-slate-600"> (enregistré le {new Date(m.created_at).toLocaleDateString('fr-FR')} à {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})</span>
                            )}
                          </span>
                        </div>
                      </button>
                      <button onClick={() => setMatchToDelete(m)} title="Supprimer ce match" className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 hover:bg-rose-900/60 text-rose-400 transition">🗑️</button>
                    </div>
                  ))}
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
                Le chrono repart à <span className="font-bold text-white">{formatTime(game.config.periodMinutes * 60)}</span> et toutes les actions déjà enregistrées pour cette période (temps de jeu inclus) seront effacées de l'historique. Les autres périodes ne sont pas concernées. Cette action est irréversible.
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
                    <button onClick={() => changePeriod(game.period + 1)} className="w-5 h-5 rounded-full bg-slate-800 text-amber-400 font-black text-xs border border-amber-500/30">+</button>
                  </div>
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
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Joueuses sur le terrain</h3>
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

            {selectedPlayer && (
              <div className="bg-slate-900/95 backdrop-blur-md border-2 border-amber-500 p-4 rounded-3xl shadow-2xl text-white space-y-4 animate-fade-in">
                <div className="flex items-center border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="bg-amber-500 text-slate-950 px-2 py-0.5 rounded-lg font-black text-sm">#{selectedPlayer.number}</span>
                    <span className="font-bold text-sm text-amber-400">{getShortDisplayName(selectedPlayer, game.matchRoster)}</span>
                  </div>
                  <div className="flex-1 flex justify-center px-3 py-1">
                    {(() => {
                      const s = getPlayerStats(selectedPlayer.id, 'ALL');
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
                      onClick={() => { const last = getLastPlayerAction(selectedPlayer.id); if (last) setActionToUndo(last); }}
                      disabled={!getLastPlayerAction(selectedPlayer.id)}
                      title="Supprimer la dernière action enregistrée"
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-400 disabled:opacity-30 disabled:hover:bg-slate-800 transition"
                    >🧹</button>
                    <button onClick={() => setSelectedPlayerId(null)} className="text-xs text-slate-400 hover:text-white font-bold">Fermer ✖</button>
                  </div>
                </div>

                {actionToUndo && (
                  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => setActionToUndo(null)}>
                    <div className="bg-slate-900 border border-rose-600/60 rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
                      <h3 className="text-sm font-bold text-rose-400">Supprimer cette action ?</h3>
                      <p className="text-xs text-slate-300">
                        <span className="font-bold text-white">{getPeriodLabel(actionToUndo.period, game.config.periodCount)} - {actionToUndo.clockTime}</span> : {actionToUndo.actionType} pour <span className="font-bold text-white">#{selectedPlayer.number} {getShortDisplayName(selectedPlayer, game.matchRoster)}</span> sera retirée de l'historique. Cette action est irréversible.
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
                      <button onClick={() => recordEvent('TIR 2PTS RÉUSSI', selectedPlayer.id, 2)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 rounded-xl text-xs shadow">🟢 Réussi (+2)</button>
                      <button onClick={() => recordEvent('TIR 2PTS Manqué', selectedPlayer.id, 0)} className="bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-xs">🔴 Manqué</button>
                    </div>
                  </div>

                  <div className="bg-slate-800/60 p-2.5 rounded-2xl border border-slate-700/60 space-y-2">
                    <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Tir à 3 Points</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => recordEvent('TIR 3PTS RÉUSSI', selectedPlayer.id, 3)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 rounded-xl text-xs shadow">🟢 Réussi (+3)</button>
                      <button onClick={() => recordEvent('TIR 3PTS Manqué', selectedPlayer.id, 0)} className="bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-xs">🔴 Manqué</button>
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
                  <button onClick={() => recordEvent('REBOND OFFENSIF', selectedPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🗑️ Rebond Off.</button>
                  <button onClick={() => recordEvent('REBOND DÉFENSIF', selectedPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🛡️ Rebond Déf.</button>
                  <button onClick={() => recordEvent('PASSE DÉCISIVE', selectedPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🎯 Assist</button>
                </div>

                <div className="grid grid-cols-4 gap-2 border-t border-slate-800 pt-2">
                  <button onClick={() => recordEvent('FAUTE SUBIE', selectedPlayer.id)} className="bg-blue-950/60 hover:bg-blue-900 border border-blue-800/80 text-blue-200 text-xs font-bold py-2 rounded-xl">🛡️ Faute Subie</button>
                  <button onClick={() => recordEvent('FAUTE PERSONNELLE', selectedPlayer.id)} className="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold py-2 rounded-xl">⚠️ Faute Perso</button>
                  <button onClick={() => recordEvent('FAUTE TECHNIQUE', selectedPlayer.id)} className="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold py-2 rounded-xl">⚠️ Faute Tech.</button>
                  <button onClick={() => recordEvent('FAUTE DISQUALIFIANTE', selectedPlayer.id)} className="bg-rose-900 hover:bg-rose-800 text-white text-xs font-bold py-2 rounded-xl">🟥 Disqual.</button>
                </div>
              </div>
            )}

            {!isSubbing ? (
              <button onClick={() => setIsSubbing(true)} disabled={availableBenchPlayers.length === 0} className="w-full bg-indigo-600/80 hover:bg-indigo-600 disabled:opacity-40 border border-indigo-400/30 text-white font-bold py-3 rounded-2xl shadow-md transition flex items-center justify-center space-x-2">
                <span>🔄 Effectuer un ou plusieurs changements</span>
              </button>
            ) : (
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
                {Array.from({ length: game.config.periodCount }, (_, i) => i + 1).map(pNum => (
                  <button key={pNum} onClick={() => setSelectedPeriodFilter(pNum)} className={`px-2.5 py-1 rounded-lg transition ${selectedPeriodFilter === pNum ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'}`}>
                    {getPeriodLabel(pNum, game.config.periodCount)}
                  </button>
                ))}
              </div>
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
                    <th className="py-2 px-1 text-center">FT</th>
                    <th className="py-2 px-1 text-center text-blue-400">FS</th>
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
                        <td className="py-2.5 px-1 text-center text-rose-400 font-bold">{st.fouls}</td>
                        <td className="py-2.5 px-1 text-center text-blue-400 font-bold">{st.foulsDrawn}</td>
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
            <h2 className="text-base font-bold text-amber-400 border-b border-slate-800 pb-3">Historique du Match</h2>
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