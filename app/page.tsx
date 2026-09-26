'use client';

import React, { useState, useEffect } from 'react';
import { GameState, Player, GameEvent } from '../types/basketball';

const DEFAULT_PLAYERS: Player[] = [
  { id: '1', number: 4, name: 'MAYRA' },
  { id: '2', number: 5, name: 'CANDICE' },
  { id: '3', number: 6, name: 'ANNABELLE' },
  { id: '4', number: 7, name: 'L. DUBOIS' },
  { id: '5', number: 9, name: 'C. BERNARD' },
  { id: '6', number: 10, name: 'E. THOMAS' },
  { id: '7', number: 12, name: 'M. ROBERT' },
  { id: '8', number: 14, name: 'A. RICHARD' },
  { id: '9', number: 15, name: 'J. PETIT' },
  { id: '10', number: 18, name: 'M. DURAND' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'INIT' | 'MATCH' | 'STATS' | 'LOGS'>('MATCH');
  const [selectedQuarterFilter, setSelectedQuarterFilter] = useState<number | 'ALL'>('ALL');

  const [game, setGame] = useState<GameState>({
    teamHome: 'SATHONAY',
    teamAway: 'ASVEL U18',
    matchDate: new Date().toISOString().split('T')[0],
    quarter: 1,
    clockSeconds: 600,
    isClockRunning: false,
    scoreHome: 0,
    scoreAway: 0,
    roster: DEFAULT_PLAYERS,
    onCourtPlayerIds: ['1', '2', '3', '4', '5'],
    events: []
  });

  const [playingTime, setPlayingTime] = useState<{ [playerId: string]: { [quarter: number]: number } }>({});

  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [ftAttempts, setFtAttempts] = useState<[boolean | null, boolean | null, boolean | null]>([null, null, null]);

  const [isSubbing, setIsSubbing] = useState(false);
  const [selectedOutIds, setSelectedOutIds] = useState<string[]>([]);
  const [selectedInIds, setSelectedInIds] = useState<string[]>([]);

  useEffect(() => {
    let timer: any;
    if (game.isClockRunning && game.clockSeconds > 0) {
      timer = setInterval(() => {
        setGame(prev => ({ ...prev, clockSeconds: prev.clockSeconds - 1 }));

        setPlayingTime(prev => {
          const updated = { ...prev };
          game.onCourtPlayerIds.forEach(id => {
            if (!updated[id]) updated[id] = {};
            updated[id][game.quarter] = (updated[id][game.quarter] || 0) + 1;
          });
          return updated;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [game.isClockRunning, game.clockSeconds, game.onCourtPlayerIds, game.quarter]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getFoulsCount = (playerId: string) => {
    return game.events.filter(e => e.playerId === playerId && e.actionType.includes('FAUTE')).length;
  };

  const getTeamFoulsForQuarter = (q: number) => {
    return game.events.filter(e => e.quarter === q && e.actionType.includes('FAUTE')).length;
  };

  const availableBenchPlayers = game.roster.filter(
    p => !game.onCourtPlayerIds.includes(p.id) && getFoulsCount(p.id) < 5
  );

  const toggleStarter = (id: string) => {
    if (game.onCourtPlayerIds.includes(id)) {
      if (game.onCourtPlayerIds.length > 1) {
        setGame({ ...game, onCourtPlayerIds: game.onCourtPlayerIds.filter(i => i !== id) });
      }
    } else {
      if (game.onCourtPlayerIds.length < 5) {
        setGame({ ...game, onCourtPlayerIds: [...game.onCourtPlayerIds, id] });
      }
    }
  };

  const recordEvent = (action: string, playerId: string, points = 0) => {
    const newEvent: GameEvent = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      quarter: game.quarter,
      clockTime: formatTime(game.clockSeconds),
      actionType: action,
      playerId: playerId
    };

    let updatedOnCourt = [...game.onCourtPlayerIds];
    let alertFoul = false;

    if (action.includes('FAUTE')) {
      const currentFouls = getFoulsCount(playerId) + 1;
      if (currentFouls >= 5) {
        updatedOnCourt = updatedOnCourt.filter(id => id !== playerId);
        alertFoul = true;
      }
    }

    setGame(prev => ({
      ...prev,
      scoreHome: prev.scoreHome + points,
      onCourtPlayerIds: updatedOnCourt,
      events: [newEvent, ...prev.events]
    }));

    setSelectedAction(null);
    setSelectedPlayerId(null);
    setFtAttempts([null, null, null]);

    if (alertFoul) {
      const p = game.roster.find(r => r.id === playerId);
      const benchAvailable = game.roster.filter(
        item => item.id !== playerId && !game.onCourtPlayerIds.includes(item.id) && getFoulsCount(item.id) < 5
      );

      if (benchAvailable.length > 0) {
        setSelectedOutIds([playerId]);
        setIsSubbing(true);
        alert(`⚠️ 5 FAUTES POUR #${p?.number} ${p?.name} !
Elle est définitivement exclue. Choisissez sa remplaçante.`);
      } else {
        alert(`⚠️ 5 FAUTES POUR #${p?.number} ${p?.name} !
Elle est exclue. Banc vide ou épuisé : le match continue à ${updatedOnCourt.length}.`);
      }
    }
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
    const actionText = `LANCERS FRANCS (${points}/${details.length})`;
    recordEvent(actionText, selectedPlayerId, points);
  };

  const toggleSelectOut = (id: string) => {
    if (getFoulsCount(id) >= 5) return;
    setSelectedOutIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectIn = (id: string) => {
    if (selectedInIds.includes(id)) {
      setSelectedInIds(selectedInIds.filter(i => i !== id));
    } else if (selectedInIds.length < selectedOutIds.length) {
      setSelectedInIds([...selectedInIds, id]);
    }
  };

  const validateSubstitutions = () => {
    if (selectedOutIds.length !== selectedInIds.length || selectedOutIds.length === 0) return;

    const pOutNames = selectedOutIds.map(id => "#" + game.roster.find(p => p.id === id)?.number).join(', ');
    const pInNames = selectedInIds.map(id => "#" + game.roster.find(p => p.id === id)?.number).join(', ');

    const subEvent: GameEvent = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      quarter: game.quarter,
      clockTime: formatTime(game.clockSeconds),
      actionType: `REMPLACEMENT (${selectedOutIds.length}j) - Out: ${pOutNames} / In: ${pInNames}`,
      playerId: selectedInIds[0]
    };

    setGame(prev => ({
      ...prev,
      onCourtPlayerIds: [
        ...prev.onCourtPlayerIds.filter(id => !selectedOutIds.includes(id)),
        ...selectedInIds
      ],
      events: [subEvent, ...prev.events]
    }));

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
      const regexLF = new RegExp('\\((\\d+)/(\\d+)\\)');
      const matchLF = eventToDelete.actionType.match(regexLF);
      if (matchLF) pointsToRemove = parseInt(matchLF[1], 10);
    }

    setGame(prev => ({
      ...prev,
      scoreHome: Math.max(0, prev.scoreHome - pointsToRemove),
      events: prev.events.filter(ev => ev.id !== eventId)
    }));
  };

  const getPlayerStats = (playerId: string, quarterFilter: number | 'ALL') => {
    const eventsToAnalyze = game.events.filter(e => {
      const matchPlayer = e.playerId === playerId;
      const matchQuarter = quarterFilter === 'ALL' ? true : e.quarter === quarterFilter;
      return matchPlayer && matchQuarter;
    });

    let points = 0, fouls = 0, ftMade = 0, ftAttempted = 0, pts2Made = 0, pts2Att = 0, pts3Made = 0, pts3Att = 0;
    let rebOff = 0, rebDef = 0, assists = 0;

    eventsToAnalyze.forEach(ev => {
      const act = ev.actionType;
      if (act.includes('FAUTE')) fouls++;
      if (act.includes('PASSE DÉCISIVE')) assists++;
      if (act.includes('REBOND OFFENSIF')) rebOff++;
      if (act.includes('REBOND DÉFENSIF')) rebDef++;
      
      if (act.includes('TIR 2PTS')) {
        pts2Att++;
        if (!act.includes('Manqué')) {
          pts2Made++;
          points += 2;
        }
      }
      if (act.includes('TIR 3PTS')) {
        pts3Att++;
        if (!act.includes('Manqué')) {
          pts3Made++;
          points += 3;
        }
      }
      if (act.includes('LANCERS FRANCS')) {
        const regexLF = new RegExp('\\((\\d+)/(\\d+)\\)');
        const match = act.match(regexLF);
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
      if (quarterFilter === 'ALL') {
        totalSecs = Object.values(playingTime[playerId]).reduce((a, b) => a + b, 0);
      } else {
        totalSecs = playingTime[playerId][quarterFilter] || 0;
      }
    }

    return { points, totalSecs, fouls, ftMade, ftAttempted, pts2Made, pts2Att, pts3Made, pts3Att, rebOff, rebDef, assists };
  };

  // 5 Carrés de Fautes (avec taille ajustable via size="small")
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
            if (isFourthBlinking) {
              colorClasses = 'bg-amber-400 shadow-sm shadow-amber-400 animate-pulse';
            } else {
              colorClasses = 'bg-amber-400 shadow-sm shadow-amber-400';
            }
          }

          return (
            <div 
              key={box} 
              className={`${boxSizeClass} rounded-sm transition ${colorClasses}`} 
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto min-h-screen pb-12 pt-4 px-2">
      {/* BANDEAU SUPERIEUR ALIGNE ET LOGO ROND */}
      <header className="bg-slate-900/90 backdrop-blur-md text-white rounded-2xl border border-slate-700/50 shadow-lg mb-4">
        <div className="flex justify-between items-center px-4 py-2.5">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center p-0.5 shadow-md">
              <svg className="w-7 h-7 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" fill="#1e293b" />
                <path d="M12 2a10 10 0 0 0-10 10h20a10 10 0 0 0-10-10z" fill="#f59e0b" />
              </svg>
            </div>
            <span className="font-extrabold tracking-wider text-amber-500 text-sm uppercase">Sathonay Basket</span>
          </div>
          
          <nav className="flex space-x-1.5 bg-slate-800 p-1 rounded-xl text-base font-semibold border border-slate-700/60">
            <button 
              onClick={() => setActiveTab('INIT')}
              title="Configuration"
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${
                activeTab === 'INIT' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              ⚙️
            </button>

            <button 
              onClick={() => setActiveTab('MATCH')}
              title="Direct"
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${
                activeTab === 'MATCH' ? 'bg-blue-600 text-white shadow-md' : 'text-blue-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              🏀
            </button>

            <button 
              onClick={() => setActiveTab('STATS')}
              title="Statistiques"
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${
                activeTab === 'STATS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              📊
            </button>

            <button 
              onClick={() => setActiveTab('LOGS')}
              title="Historique"
              className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${
                activeTab === 'LOGS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              🕒
            </button>
          </nav>
        </div>
      </header>

      <main>
        {activeTab === 'INIT' && (
          <div className="bg-slate-900/85 backdrop-blur text-white p-6 rounded-3xl space-y-6 shadow-2xl border border-white/10">
            <h2 className="text-xl font-bold border-b border-slate-700 pb-3 text-amber-400">Initialisation de la rencontre</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Équipe Domicile</label>
                <input 
                  type="text" 
                  value={game.teamHome} 
                  onChange={e => setGame({...game, teamHome: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Équipe Adverse</label>
                <input 
                  type="text" 
                  value={game.teamAway} 
                  onChange={e => setGame({...game, teamAway: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-semibold text-slate-400">Composition : 10 Joueuses (5 titulaires)</label>
                <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                  {game.onCourtPlayerIds.length}/5 Titulaires
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                {game.roster.map(p => {
                  const isStarter = game.onCourtPlayerIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleStarter(p.id)}
                      className={`flex items-center space-x-3 p-3 rounded-xl border text-left transition ${
                        isStarter 
                          ? 'bg-amber-600/30 border-amber-500 text-white font-bold' 
                          : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
                      }`}
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black ${isStarter ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>
                        #{p.number}
                      </span>
                      <span className="text-sm truncate">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button 
              onClick={() => setActiveTab('MATCH')}
              disabled={game.onCourtPlayerIds.length !== 5}
              className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl shadow-lg transition"
            >
              Valider & Passer au terrain
            </button>
          </div>
        )}

        {activeTab === 'MATCH' && (
          <div className="space-y-4">
            {game.onCourtPlayerIds.length < 5 && availableBenchPlayers.length > 0 && (
              <div className="bg-rose-900/90 border border-rose-500 text-white p-3.5 rounded-2xl text-xs font-bold flex justify-between items-center animate-pulse">
                <span>⚠️ Il manque {5 - game.onCourtPlayerIds.length} joueuse(s) sur le terrain.</span>
                <button onClick={() => setIsSubbing(true)} className="bg-white text-rose-950 px-2.5 py-1 rounded-xl uppercase font-black text-[10px]">Faire entrer</button>
              </div>
            )}

            {/* SCOREBOARD ALIGNÉ */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 text-white p-4 rounded-3xl shadow-2xl space-y-4">
              <div className="grid grid-cols-3 items-center text-center">
                
                {/* BLOC DOMICILE */}
                <div className="flex flex-col items-center justify-center">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamHome}</p>
                  <p className="text-4xl font-black text-amber-400 my-1">{game.scoreHome}</p>
                  <div className="flex justify-center space-x-1">
                    <button onClick={() => setGame({...game, scoreHome: Math.max(0, game.scoreHome - 1)})} className="text-xs text-slate-400 font-bold px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">-</button>
                    <button onClick={() => setGame({...game, scoreHome: game.scoreHome + 1})} className="text-xs text-slate-200 font-bold px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">+</button>
                  </div>
                </div>

                {/* BLOC CHRONO ET QUART-TEMPS */}
                <div className="flex flex-col items-center justify-center border-x border-slate-800 px-2">
                  <div className="flex items-center justify-center space-x-2">
                    <button 
                      onClick={() => setGame(prev => ({ ...prev, quarter: Math.max(1, prev.quarter - 1) }))}
                      className="w-5 h-5 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-400 font-black text-xs border border-amber-500/30 flex items-center justify-center"
                    >
                      -
                    </button>
                    <span className="bg-slate-800 text-amber-400 border border-amber-500/30 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">
                      Q{game.quarter}
                    </span>
                    <button 
                      onClick={() => setGame(prev => ({ ...prev, quarter: Math.min(4, prev.quarter + 1) }))}
                      className="w-5 h-5 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-400 font-black text-xs border border-amber-500/30 flex items-center justify-center"
                    >
                      +
                    </button>
                  </div>

                  <p className="text-3xl font-mono font-bold my-1 tracking-tight text-white">{formatTime(game.clockSeconds)}</p>
                  <div className="flex justify-center space-x-1">
                    <button 
                      onClick={() => setGame({...game, isClockRunning: !game.isClockRunning})}
                      className={`text-[10px] font-extrabold px-3 py-1 rounded-lg transition ${game.isClockRunning ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}
                    >
                      {game.isClockRunning ? 'PAUSE' : 'START'}
                    </button>
                    <button 
                      onClick={() => setGame({...game, clockSeconds: 600, isClockRunning: false})}
                      className="text-[10px] font-extrabold px-2 py-1 bg-slate-800 text-slate-400 rounded-lg hover:text-white"
                    >
                      RESET
                    </button>
                  </div>
                </div>

                {/* BLOC EXTERIEUR */}
                <div className="flex flex-col items-center justify-center">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamAway}</p>
                  <p className="text-4xl font-black text-slate-300 my-1">{game.scoreAway}</p>
                  <div className="flex justify-center space-x-1">
                    <button onClick={() => setGame({...game, scoreAway: Math.max(0, game.scoreAway - 1)})} className="text-xs text-slate-400 font-bold px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">-</button>
                    <button onClick={() => setGame({...game, scoreAway: game.scoreAway + 1})} className="text-xs text-slate-200 font-bold px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700">+</button>
                  </div>
                </div>
              </div>

              {/* MODULE COMBINÉ : FAUTES ÉQUIPE (Q EN COURS) ET 5 JOUEUSES SUR LE TERRAIN */}
              <div className="pt-3 border-t border-slate-800/80">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[11px] font-extrabold text-amber-400 uppercase tracking-wider">FAUTES D'ÉQUIPE</span>
                  <span className="text-[10px] text-slate-400 font-bold">Q{game.quarter} : {getTeamFoulsForQuarter(game.quarter)}/5</span>
                </div>
                
                <div className="grid grid-cols-12 gap-2 items-center">
                  {/* FAUTES ÉQUIPE QUART-TEMPS EN COURS */}
                  <div className="col-span-3 p-2 bg-slate-800 border border-amber-500/50 rounded-xl flex flex-col items-center justify-center h-full">
                    <span className="text-[9px] font-black text-amber-400 uppercase mb-1">Q{game.quarter} (En cours)</span>
                    <FoulSquares count={getTeamFoulsForQuarter(game.quarter)} />
                  </div>

                  {/* 5 JOUEUSES SUR LE TERRAIN AVEC LEURS FAUTES */}
                  <div className="col-span-9 grid grid-cols-5 gap-1">
                    {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => {
                      const fouls = getFoulsCount(p.id);
                      return (
                        <div key={p.id} className="bg-slate-800/80 border border-slate-700/80 p-1 rounded-xl flex flex-col items-center justify-center text-center">
                          <span className="text-[10px] font-black text-white truncate w-full">#{p.number}</span>
                          <span className="text-[8px] text-slate-300 font-bold truncate w-full mb-1">{p.name}</span>
                          <FoulSquares count={fouls} size="small" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {!isSubbing ? (
              <button 
                onClick={() => setIsSubbing(true)}
                disabled={availableBenchPlayers.length === 0}
                className="w-full bg-indigo-600/80 hover:bg-indigo-600 disabled:opacity-40 border border-indigo-400/30 text-white font-bold py-3 rounded-2xl shadow-md transition flex items-center justify-center space-x-2"
              >
                <span>🔄 Faire un ou plusieurs changements</span>
              </button>
            ) : (
              <div className="bg-slate-900/90 backdrop-blur-md border border-indigo-500/50 p-4 rounded-3xl shadow-xl space-y-4 text-white">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Changements multiples</h3>
                  <button onClick={() => { setIsSubbing(false); setSelectedOutIds([]); setSelectedInIds([]); }} className="text-xs text-rose-400 font-bold">ANNULER</button>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-rose-400 font-bold mb-2">1. SUR LE PARQUET — Décocher / Sélectionner la (les) sortie(s) ({selectedOutIds.length}) :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id) || selectedOutIds.includes(p.id)).map(p => {
                        const isSelected = selectedOutIds.includes(p.id);
                        const fouls = getFoulsCount(p.id);
                        const isFouledOut = fouls >= 5;

                        return (
                          <button
                            key={p.id}
                            disabled={isFouledOut}
                            onClick={() => toggleSelectOut(p.id)}
                            className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition ${
                              isFouledOut 
                                ? 'bg-rose-950/80 border-rose-600 text-rose-200 cursor-not-allowed font-bold'
                                : isSelected 
                                  ? 'bg-rose-500/20 border-rose-500 text-white font-bold' 
                                  : 'bg-slate-800 border-slate-700/60 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <input type="checkbox" checked={isSelected} readOnly disabled={isFouledOut} className="accent-rose-500" />
                              <span className="truncate">#{p.number} {p.name}</span>
                            </div>
                            <FoulSquares count={fouls} size="small" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-emerald-400 font-bold mb-2">2. SUR LE BANC — Cocher la (les) entrée(s) ({selectedInIds.length}) :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {game.roster.filter(p => !game.onCourtPlayerIds.includes(p.id) && !selectedOutIds.includes(p.id)).map(p => {
                        const fouls = getFoulsCount(p.id);
                        const isFouledOut = fouls >= 5;
                        const isSelected = selectedInIds.includes(p.id);

                        return (
                          <button
                            key={p.id}
                            disabled={isFouledOut}
                            onClick={() => toggleSelectIn(p.id)}
                            className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition ${
                              isFouledOut 
                                ? 'bg-slate-900/60 border-slate-800 text-slate-600 cursor-not-allowed'
                                : isSelected 
                                  ? 'bg-emerald-500/20 border-emerald-500 text-white font-bold' 
                                  : 'bg-slate-800 border-slate-700/60 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center space-x-2 truncate">
                              {!isFouledOut && <input type="checkbox" checked={isSelected} readOnly className="accent-emerald-500" />}
                              <span className="truncate">#{p.number} {p.name}</span>
                            </div>
                            <FoulSquares count={fouls} size="small" />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedInIds.length > 0 && selectedOutIds.length === selectedInIds.length && (
                    <button 
                      onClick={validateSubstitutions}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl shadow-lg transition"
                    >
                      Valider le(s) remplacement(s)
                    </button>
                  )}
                </div>
              </div>
            )}

            {!selectedAction ? (
              <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 p-4 rounded-3xl shadow-xl space-y-3">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider text-center">1. Choisir l'action</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <button onClick={() => setSelectedAction('TIR 2PTS')} className="p-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">TIR 2PTS</button>
                  <button onClick={() => setSelectedAction('TIR 3PTS')} className="p-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">TIR 3PTS</button>
                  <button onClick={() => setSelectedAction('LANCERS FRANCS')} className="p-3.5 bg-amber-600/30 hover:bg-amber-600/40 text-amber-300 font-bold text-sm rounded-2xl border border-amber-500/50 shadow">LANCER FRANC</button>
                  <button onClick={() => setSelectedAction('PASSE DÉCISIVE')} className="p-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">PASSE DEC.</button>
                  <button onClick={() => setSelectedAction('REBOND OFFENSIF')} className="p-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-2xl border border-slate-700/80 shadow">REBOND OFF.</button>
                  <button onClick={() => setSelectedAction('REBOND DÉFENSIF')} className="p-3.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-2xl border border-slate-700/80 shadow">REBOND DEF.</button>
                  <button onClick={() => setSelectedAction('FAUTE')} className="p-3.5 bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 font-bold text-sm rounded-2xl border border-rose-700/50 shadow col-span-2">FAUTE</button>
                </div>
              </div>
            ) : !selectedPlayerId ? (
              <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-4 rounded-3xl shadow-xl space-y-3">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold text-amber-400 uppercase">Action : {selectedAction}</span>
                  <button onClick={() => setSelectedAction(null)} className="text-xs text-rose-400 font-bold">ANNULER</button>
                </div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider text-center">2. Sélectionner la joueuse sur le parquet</h3>
                <div className="space-y-2">
                  {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => {
                    const fouls = getFoulsCount(p.id);
                    return (
                      <button 
                        key={p.id} 
                        onClick={() => setSelectedPlayerId(p.id)} 
                        className="w-full flex items-center justify-between p-3.5 bg-slate-800 border border-slate-700/80 rounded-2xl text-white hover:bg-slate-700 transition"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black text-sm">#{p.number}</span>
                          <span className="font-bold text-sm">{p.name}</span>
                        </div>
                        <FoulSquares count={fouls} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : selectedAction === 'LANCERS FRANCS' ? (
              <div className="bg-slate-900/90 backdrop-blur-md border border-amber-500/30 p-5 rounded-3xl shadow-xl space-y-4 text-center">
                <h3 className="text-sm font-bold text-amber-400 uppercase">Saisie des Lancers Francs</h3>
                <p className="text-xs text-slate-300">
                  Joueuse : <strong className="text-white">#{game.roster.find(p => p.id === selectedPlayerId)?.number} {game.roster.find(p => p.id === selectedPlayerId)?.name}</strong>
                </p>

                <div className="space-y-3 py-2">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="flex items-center justify-between bg-slate-800 p-3 rounded-2xl border border-slate-700">
                      <span className="font-bold text-xs text-slate-300">Lancer Franc #{index + 1}</span>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            const newFt = [...ftAttempts] as [boolean | null, boolean | null, boolean | null];
                            newFt[index] = true;
                            setFtAttempts(newFt);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                            ftAttempts[index] === true ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          RÉUSSI
                        </button>
                        <button
                          onClick={() => {
                            const newFt = [...ftAttempts] as [boolean | null, boolean | null, boolean | null];
                            newFt[index] = false;
                            setFtAttempts(newFt);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                            ftAttempts[index] === false ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          RATÉ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={handleFreeThrowsSubmit}
                  disabled={ftAttempts.every(v => v === null)}
                  className="w-full p-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold rounded-2xl shadow-lg transition"
                >
                  VALIDER LES LANCERS FRANCS
                </button>

                <button onClick={() => { setSelectedAction(null); setSelectedPlayerId(null); setFtAttempts([null, null, null]); }} className="text-xs text-slate-400 font-semibold underline block mx-auto">
                  Annuler
                </button>
              </div>
            ) : (
              <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-5 rounded-3xl shadow-xl space-y-4 text-center">
                <h3 className="text-sm font-bold text-amber-400 uppercase">3. Résultat</h3>
                <p className="text-xs text-slate-300">
                  {selectedAction} par <strong className="text-white">#{game.roster.find(p => p.id === selectedPlayerId)?.number} {game.roster.find(p => p.id === selectedPlayerId)?.name}</strong>
                </p>

                {selectedAction?.includes('TIR') ? (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <button 
                      onClick={() => recordEvent(selectedAction, selectedPlayerId, selectedAction === 'TIR 3PTS' ? 3 : 2)}
                      className="p-5 bg-emerald-700 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-lg text-lg"
                    >
                      RÉUSSI
                    </button>
                    <button 
                      onClick={() => recordEvent(selectedAction + ' (Manqué)', selectedPlayerId, 0)}
                      className="p-5 bg-rose-700 hover:bg-rose-600 text-white font-black rounded-2xl shadow-lg text-lg"
                    >
                      MANQUÉ
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => recordEvent(selectedAction, selectedPlayerId, 0)}
                    className="w-full p-4 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-2xl shadow-lg"
                  >
                    VALIDER L'ACTION
                  </button>
                )}

                <button onClick={() => { setSelectedAction(null); setSelectedPlayerId(null); }} className="text-xs text-slate-400 font-semibold underline block mx-auto">
                  Annuler
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'STATS' && (
          <div className="bg-slate-900/90 backdrop-blur text-white p-5 rounded-3xl space-y-5 shadow-2xl border border-white/10">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-amber-400">Statistiques des Joueuses</h2>
              
              <div className="flex space-x-1 bg-slate-800 p-1 rounded-xl text-xs font-bold border border-slate-700">
                {(['ALL', 1, 2, 3, 4] as const).map(q => (
                  <button
                    key={q}
                    onClick={() => setSelectedQuarterFilter(q)}
                    className={`px-2.5 py-1 rounded-lg transition ${
                      selectedQuarterFilter === q ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {q === 'ALL' ? 'Total' : `Q${q}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse min-w-[650px]">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-2">Joueuse</th>
                    <th className="py-2.5 px-2 text-center">Temps</th>
                    <th className="py-2.5 px-2 text-center font-bold text-amber-400">PTS</th>
                    <th className="py-2.5 px-2 text-center">Fautes</th>
                    <th className="py-2.5 px-2 text-center">LF</th>
                    <th className="py-2.5 px-2 text-center">2PTS</th>
                    <th className="py-2.5 px-2 text-center">3PTS</th>
                    <th className="py-2.5 px-2 text-center">Reb. Off/Def</th>
                    <th className="py-2.5 px-2 text-center">Passe D.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {game.roster.map(player => {
                    const st = getPlayerStats(player.id, selectedQuarterFilter);
                    const isFouledOut = st.fouls >= 5;

                    return (
                      <tr key={player.id} className={`hover:bg-slate-800/40 transition ${isFouledOut ? 'bg-rose-950/20' : ''}`}>
                        <td className="py-3 px-2 font-bold text-slate-200 flex items-center justify-between">
                          <span>#{player.number} {player.name}</span>
                          {isFouledOut && <span className="text-[9px] bg-rose-900 text-rose-300 font-bold px-1.5 py-0.5 rounded ml-2">EXCLUE</span>}
                        </td>
                        <td className="py-3 px-2 text-center font-mono text-amber-300">
                          {formatTime(st.totalSecs)}
                        </td>
                        <td className="py-3 px-2 text-center font-black text-amber-400 text-sm">
                          {st.points}
                        </td>
                        <td className="py-3 px-2 text-center flex justify-center">
                          <FoulSquares count={st.fouls} />
                        </td>
                        <td className="py-3 px-2 text-center">
                          {st.ftMade}/{st.ftAttempted}
                        </td>
                        <td className="py-3 px-2 text-center">
                          {st.pts2Made}/{st.pts2Att}
                        </td>
                        <td className="py-3 px-2 text-center">
                          {st.pts3Made}/{st.pts3Att}
                        </td>
                        <td className="py-3 px-2 text-center text-slate-300">
                          <span className="text-emerald-400">{st.rebOff}</span> / <span className="text-blue-400">{st.rebDef}</span>
                        </td>
                        <td className="py-3 px-2 text-center font-bold text-amber-400">
                          {st.assists}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'LOGS' && (
          <div className="bg-slate-900/85 backdrop-blur text-white p-5 rounded-3xl space-y-4 shadow-2xl border border-white/10">
            <h2 className="text-lg font-bold border-b border-slate-800 pb-3 text-amber-400">Historique du match</h2>
            {game.events.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">Aucune action enregistrée pour le moment.</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {game.events.map(ev => {
                  const player = game.roster.find(p => p.id === ev.playerId);
                  return (
                    <div key={ev.id} className="flex justify-between items-center p-3 bg-slate-800/70 border border-slate-700/50 rounded-xl text-xs hover:border-slate-600 transition">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-amber-400 font-bold">Q{ev.quarter} [{ev.clockTime}]</span>
                        <span className="font-bold text-white">#{player?.number} {player?.name}</span>
                      </div>
                      
                      <div className="flex items-center space-x-3">
                        <span className="bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg font-semibold">{ev.actionType}</span>
                        <button 
                          onClick={() => deleteEvent(ev.id)}
                          title="Supprimer cette ligne"
                          className="text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 px-2 py-1 rounded-lg transition font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}