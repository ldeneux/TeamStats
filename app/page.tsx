'use client';

import React, { useState, useEffect } from 'react';

export interface Player { id: string; number: number; name: string; }
export interface GameEvent { id: string; timestamp: string; quarter: number; clockTime: string; actionType: string; playerId: string; details?: any; }
export interface GameState {
  teamHome: string;
  teamAway: string;
  matchDate: string;
  quarter: number;
  clockSeconds: number;
  isClockRunning: boolean;
  scoreHome: number;
  scoreAway: number;
  roster: Player[];
  onCourtPlayerIds: string[];
  events: GameEvent[];
}

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
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [ftAttempts, setFtAttempts] = useState<[boolean | null, boolean | null, boolean | null]>([null, null, null]);

  const [isSubbing, setIsSubbing] = useState(false);
  const [selectedOutIds, setSelectedOutIds] = useState<string[]>([]);
  const [selectedInIds, setSelectedInIds] = useState<string[]>([]);

  // Chronomètre et calcul du temps de jeu
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

    setSelectedPlayerId(null);
    setFtAttempts([null, null, null]);

    if (alertFoul) {
      const p = game.roster.find(r => r.id === playerId);
      setSelectedOutIds([playerId]);
      setIsSubbing(true);
      alert(`⚠️ 5 FAUTES POUR #${p?.number} ${p?.name} !\nJoueuse exclue. Veuillez effectuer le remplacement.`);
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
    recordEvent(`LANCERS FRANCS (${points}/${details.length})`, selectedPlayerId, points);
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
      const matchLF = eventToDelete.actionType.match(/\((\d+)\/\d+\)/);
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
      if (quarterFilter === 'ALL') {
        totalSecs = Object.values(playingTime[playerId]).reduce((a, b) => a + b, 0);
      } else {
        totalSecs = playingTime[playerId][quarterFilter] || 0;
      }
    }

    return { points, totalSecs, fouls, ftMade, ftAttempted, pts2Made, pts2Att, pts3Made, pts3Att, rebOff, rebDef, assists };
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

  const selectedPlayer = game.roster.find(p => p.id === selectedPlayerId);

  return (
    <div className="max-w-3xl mx-auto min-h-screen pb-12 pt-4 px-2">
      {/* HEADER NAVBAR */}
      <header className="bg-slate-900/90 backdrop-blur-md text-white rounded-2xl border border-slate-700/50 shadow-lg mb-4">
        <div className="flex justify-between items-center px-4 py-2.5">
          <div className="flex items-center space-x-2.5">
            <span className="font-extrabold tracking-wider text-amber-500 text-sm uppercase">Sathonay Basket</span>
          </div>
          
          <nav className="flex space-x-1.5 bg-slate-800 p-1 rounded-xl text-base font-semibold border border-slate-700/60">
            <button onClick={() => setActiveTab('INIT')} title="Configuration" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'INIT' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>⚙️</button>
            <button onClick={() => setActiveTab('MATCH')} title="Direct" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'MATCH' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>🏀</button>
            <button onClick={() => setActiveTab('STATS')} title="Statistiques" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'STATS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>📊</button>
            <button onClick={() => setActiveTab('LOGS')} title="Historique" className={`w-9 h-9 flex items-center justify-center rounded-lg transition ${activeTab === 'LOGS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}>🕒</button>
          </nav>
        </div>
      </header>

      <main>
        {/* ONGLET INIT */}
        {activeTab === 'INIT' && (
          <div className="bg-slate-900/90 text-white p-6 rounded-3xl space-y-6 border border-white/10 shadow-2xl">
            <h2 className="text-xl font-bold border-b border-slate-700 pb-3 text-amber-400">Configuration du Match</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Équipe Domicile</label>
                <input type="text" value={game.teamHome} onChange={e => setGame({...game, teamHome: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Équipe Adverse</label>
                <input type="text" value={game.teamAway} onChange={e => setGame({...game, teamAway: e.target.value})} className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-sm font-bold text-white focus:outline-none" />
              </div>
            </div>
            <button onClick={() => setActiveTab('MATCH')} className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3.5 rounded-xl shadow-lg transition">Retour au Match</button>
          </div>
        )}

        {/* ONGLET MATCH / DIRECT */}
        {activeTab === 'MATCH' && (
          <div className="space-y-4">
            {/* PANNEAU DE SCORE ET CHRONO */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 text-white p-4 rounded-3xl shadow-2xl space-y-4">
              <div className="grid grid-cols-3 items-center text-center">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamHome}</p>
                  <p className="text-4xl font-black text-amber-400 my-1">{game.scoreHome}</p>
                  <div className="flex justify-center space-x-1">
                    <button onClick={() => setGame({...game, scoreHome: Math.max(0, game.scoreHome - 1)})} className="text-xs text-slate-400 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">-</button>
                    <button onClick={() => setGame({...game, scoreHome: game.scoreHome + 1})} className="text-xs text-slate-200 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">+</button>
                  </div>
                </div>

                <div className="border-x border-slate-800 px-2">
                  <div className="flex items-center justify-center space-x-2">
                    <button onClick={() => setGame(prev => ({ ...prev, quarter: Math.max(1, prev.quarter - 1) }))} className="w-5 h-5 rounded-full bg-slate-800 text-amber-400 font-black text-xs border border-amber-500/30">-</button>
                    <span className="bg-slate-800 text-amber-400 border border-amber-500/30 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">Q{game.quarter}</span>
                    <button onClick={() => setGame(prev => ({ ...prev, quarter: Math.min(4, prev.quarter + 1) }))} className="w-5 h-5 rounded-full bg-slate-800 text-amber-400 font-black text-xs border border-amber-500/30">+</button>
                  </div>
                  <p className="text-3xl font-mono font-bold my-1 text-white">{formatTime(game.clockSeconds)}</p>
                  <div className="flex justify-center space-x-1">
                    <button onClick={() => setGame({...game, isClockRunning: !game.isClockRunning})} className={`text-[10px] font-extrabold px-3 py-1 rounded-lg transition ${game.isClockRunning ? 'bg-rose-600' : 'bg-emerald-600'}`}>{game.isClockRunning ? 'PAUSE' : 'START'}</button>
                    <button onClick={() => setGame({...game, clockSeconds: 600, isClockRunning: false})} className="text-[10px] font-extrabold px-2 py-1 bg-slate-800 text-slate-400 rounded-lg">RESET</button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamAway}</p>
                  <p className="text-4xl font-black text-slate-300 my-1">{game.scoreAway}</p>
                  <div className="flex justify-center space-x-1">
                    <button onClick={() => setGame({...game, scoreAway: Math.max(0, game.scoreAway - 1)})} className="text-xs text-slate-400 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">-</button>
                    <button onClick={() => setGame({...game, scoreAway: game.scoreAway + 1})} className="text-xs text-slate-200 font-bold px-2 py-0.5 bg-slate-800 rounded border border-slate-700">+</button>
                  </div>
                </div>
              </div>

              {/* SUIVI DES FAUTES D'ÉQUIPE */}
              <div className="pt-3 border-t border-slate-800/80">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[11px] font-extrabold text-amber-400 uppercase tracking-wider">FAUTES D'ÉQUIPE (Q{game.quarter})</span>
                  <span className="text-[10px] text-slate-400 font-bold">{getTeamFoulsForQuarter(game.quarter)}/5</span>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3 p-2 bg-slate-800 border border-amber-500/50 rounded-xl flex flex-col items-center justify-center">
                    <FoulSquares count={getTeamFoulsForQuarter(game.quarter)} />
                  </div>
                  <div className="col-span-9 grid grid-cols-5 gap-1">
                    {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => (
                      <div key={p.id} className="bg-slate-800/80 border border-slate-700 p-1 rounded-xl flex flex-col items-center justify-center text-center">
                        <span className="text-[10px] font-black text-white truncate w-full">#{p.number}</span>
                        <FoulSquares count={getFoulsCount(p.id)} size="small" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* SELECTION DES JOUEUSES SUR LE TERRAIN */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-4 rounded-3xl shadow-xl space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Joueuses sur le terrain (Sélectionner pour une action)</h3>
              <div className="grid grid-cols-5 gap-2">
                {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => {
                  const isSelected = selectedPlayerId === p.id;
                  const fouls = getFoulsCount(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPlayerId(isSelected ? null : p.id)}
                      className={`flex flex-col items-center p-2 rounded-2xl border transition ${isSelected ? 'bg-amber-500 text-slate-950 border-amber-300 ring-2 ring-amber-400 shadow-lg scale-105' : 'bg-slate-800/90 text-white border-slate-700/80 hover:bg-slate-700/80'}`}
                    >
                      <span className="text-lg font-black">#{p.number}</span>
                      <span className="text-[10px] font-bold truncate max-w-full">{p.name}</span>
                      <div className="mt-1">
                        <FoulSquares count={fouls} size="small" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* PANNEAU D'ACTIONS DÉTAILLÉES POUR LA JOUEUSE SÉLECTIONNÉE */}
            {selectedPlayer && (
              <div className="bg-slate-900/95 backdrop-blur-md border-2 border-amber-500 p-4 rounded-3xl shadow-2xl text-white space-y-4 animate-fade-in">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <span className="bg-amber-500 text-slate-950 px-2 py-0.5 rounded-lg font-black text-sm">#{selectedPlayer.number}</span>
                    <span className="font-bold text-sm text-amber-400">{selectedPlayer.name}</span>
                  </div>
                  <button onClick={() => setSelectedPlayerId(null)} className="text-xs text-slate-400 hover:text-white font-bold">Fermer ✖</button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* TIR 2 PTS */}
                  <div className="bg-slate-800/60 p-2.5 rounded-2xl border border-slate-700/60 space-y-2">
                    <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Tir à 2 Points</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => recordEvent('TIR 2PTS RÉUSSI', selectedPlayer.id, 2)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 rounded-xl text-xs shadow">🟢 Réussi (+2)</button>
                      <button onClick={() => recordEvent('TIR 2PTS Manqué', selectedPlayer.id, 0)} className="bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-xs">🔴 Manqué</button>
                    </div>
                  </div>

                  {/* TIR 3 PTS */}
                  <div className="bg-slate-800/60 p-2.5 rounded-2xl border border-slate-700/60 space-y-2">
                    <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Tir à 3 Points</span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => recordEvent('TIR 3PTS RÉUSSI', selectedPlayer.id, 3)} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 rounded-xl text-xs shadow">🟢 Réussi (+3)</button>
                      <button onClick={() => recordEvent('TIR 3PTS Manqué', selectedPlayer.id, 0)} className="bg-rose-600/80 hover:bg-rose-600 text-white font-bold py-2 rounded-xl text-xs">🔴 Manqué</button>
                    </div>
                  </div>
                </div>

                {/* LANCERS FRANCS */}
                <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/60 space-y-2">
                  <span className="text-[11px] font-extrabold text-slate-400 block uppercase">Lancers Francs</span>
                  <div className="flex space-x-2">
                    {[0, 1, 2].map(index => (
                      <div key={index} className="flex-1 flex flex-col items-center bg-slate-900/60 p-1.5 rounded-xl border border-slate-700">
                        <span className="text-[10px] font-bold text-slate-400 mb-1">LF {index + 1}</span>
                        <div className="flex space-x-1 w-full">
                          <button
                            onClick={() => {
                              const updated = [...ftAttempts] as [boolean | null, boolean | null, boolean | null];
                              updated[index] = true;
                              setFtAttempts(updated);
                            }}
                            className={`flex-1 py-1 rounded text-xs font-black ${ftAttempts[index] === true ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-400'}`}
                          >✓</button>
                          <button
                            onClick={() => {
                              const updated = [...ftAttempts] as [boolean | null, boolean | null, boolean | null];
                              updated[index] = false;
                              setFtAttempts(updated);
                            }}
                            className={`flex-1 py-1 rounded text-xs font-black ${ftAttempts[index] === false ? 'bg-rose-500 text-white' : 'bg-slate-800 text-slate-400'}`}
                          >✗</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {ftAttempts.some(v => v !== null) && (
                    <button onClick={handleFreeThrowsSubmit} className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-xl text-xs transition">Valider les lancers francs</button>
                  )}
                </div>

                {/* AUTRES ACTIONS (REBONDS, PASSES, FAUTES) */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button onClick={() => recordEvent('REBOND OFFENSIF', selectedPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🗑️ Rebond Off.</button>
                  <button onClick={() => recordEvent('REBOND DÉFENSIF', selectedPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🛡️ Rebond Déf.</button>
                  <button onClick={() => recordEvent('PASSE DÉCISIVE', selectedPlayer.id)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold py-2.5 rounded-xl">🎯 Assist</button>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-slate-800 pt-2">
                  <button onClick={() => recordEvent('FAUTE PERSONNELLE', selectedPlayer.id)} className="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold py-2 rounded-xl">⚠️ Faute Perso</button>
                  <button onClick={() => recordEvent('FAUTE TECHNIQUE', selectedPlayer.id)} className="bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold py-2 rounded-xl">⚠️ Faute Tech.</button>
                  <button onClick={() => recordEvent('FAUTE DISQUALIFIANTE', selectedPlayer.id)} className="bg-rose-900 hover:bg-rose-800 text-white text-xs font-bold py-2 rounded-xl">🟥 Disqualifiante</button>
                </div>
              </div>
            )}

            {/* GESTION DES REMPLACEMENTS */}
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

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-rose-400 font-bold mb-2">1. Sortie(s) ({selectedOutIds.length}) :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id) || selectedOutIds.includes(p.id)).map(p => {
                        const isSelected = selectedOutIds.includes(p.id);
                        const fouls = getFoulsCount(p.id);
                        const isFouledOut = fouls >= 5;
                        return (
                          <button key={p.id} disabled={isFouledOut} onClick={() => toggleSelectOut(p.id)} className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition ${isFouledOut ? 'bg-rose-950/80 border-rose-600 text-rose-200 cursor-not-allowed' : isSelected ? 'bg-rose-500/20 border-rose-500 text-white font-bold' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
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
                    <p className="text-xs text-emerald-400 font-bold mb-2">2. Entrée(s) ({selectedInIds.length}) :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {game.roster.filter(p => !game.onCourtPlayerIds.includes(p.id) && !selectedOutIds.includes(p.id)).map(p => {
                        const fouls = getFoulsCount(p.id);
                        const isFouledOut = fouls >= 5;
                        const isSelected = selectedInIds.includes(p.id);
                        return (
                          <button key={p.id} disabled={isFouledOut} onClick={() => toggleSelectIn(p.id)} className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition ${isFouledOut ? 'bg-slate-900/60 border-slate-800 text-slate-600 cursor-not-allowed' : isSelected ? 'bg-emerald-500/20 border-emerald-500 text-white font-bold' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
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
                    <button onClick={validateSubstitutions} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl shadow-lg transition">Valider le(s) remplacement(s)</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ONGLET STATISTIQUES */}
        {activeTab === 'STATS' && (
          <div className="bg-slate-900/90 text-white p-4 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-amber-400">Statistiques Joueuses</h2>
              <div className="flex space-x-1 bg-slate-800 p-1 rounded-xl text-xs font-bold">
                {['ALL', 1, 2, 3, 4].map(q => (
                  <button key={q} onClick={() => setSelectedQuarterFilter(q as any)} className={`px-2.5 py-1 rounded-lg transition ${selectedQuarterFilter === q ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'}`}>
                    {q === 'ALL' ? 'TOUT' : `Q${q}`}
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
                    <th className="py-2 px-1 text-center">REB</th>
                    <th className="py-2 px-1 text-center">AST</th>
                    <th className="py-2 px-1 text-center">FT</th>
                    <th className="py-2 px-1 text-right">Tps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-semibold">
                  {game.roster.map(p => {
                    const st = getPlayerStats(p.id, selectedQuarterFilter);
                    return (
                      <tr key={p.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-1 font-black text-amber-400">#{p.number}</td>
                        <td className="py-2.5 px-1 font-bold text-slate-200">{p.name}</td>
                        <td className="py-2.5 px-1 text-center font-black text-amber-300">{st.points}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.pts2Made}/{st.pts2Att}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.pts3Made}/{st.pts3Att}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.ftMade}/{st.ftAttempted}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.rebOff + st.rebDef}</td>
                        <td className="py-2.5 px-1 text-center text-slate-300">{st.assists}</td>
                        <td className="py-2.5 px-1 text-center text-rose-400 font-bold">{st.fouls}</td>
                        <td className="py-2.5 px-1 text-right font-mono text-slate-400">{formatTime(st.totalSecs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ONGLET HISTORIQUE / LOGS */}
        {activeTab === 'LOGS' && (
          <div className="bg-slate-900/90 text-white p-4 rounded-3xl space-y-4 border border-white/10 shadow-2xl">
            <h2 className="text-base font-bold text-amber-400 border-b border-slate-800 pb-3">Historique du Match</h2>
            {game.events.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">Aucun événement enregistré.</p>
            ) : (
              <div className="space-y-2">
                {game.events.map(ev => {
                  const player = game.roster.find(p => p.id === ev.playerId);
                  return (
                    <div key={ev.id} className="flex justify-between items-center bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/50 text-xs">
                      <div className="flex items-center space-x-2.5">
                        <span className="bg-slate-700 text-amber-400 font-black px-2 py-0.5 rounded text-[10px]">Q{ev.quarter} - {ev.clockTime}</span>
                        <span className="font-bold text-white">{player ? `#${player.number} ${player.name}` : 'Équipe'}</span>
                        <span className="text-slate-300">{ev.actionType}</span>
                      </div>
                      <button onClick={() => deleteEvent(ev.id)} className="text-rose-400 hover:text-rose-300 font-bold px-2 py-1 bg-rose-950/50 rounded-lg">Supprimer</button>
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
