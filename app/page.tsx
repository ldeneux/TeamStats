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
      alert(`⚠️ 5 FAUTES POUR #${p?.number} ${p?.name} !
La joueuse a été sortie du terrain et ne peut plus re-rentrer.`);
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
      const match = eventToDelete.actionType.match(/\\((\\d+)\\ me/);
      const matchLF = eventToDelete.actionType.match(/\\((\\d+)\\/(\\d+)\\)/);
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
        const match = act.match(/\\((\\d+)\\/(\\d+)\\)/);
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

  return (
    <div className="max-w-3xl mx-auto min-h-screen pb-12">
      <header className="bg-slate-900/90 backdrop-blur-md text-white sticky top-0 z-50 border-b border-slate-700/50 shadow-lg">
        <div className="flex justify-between items-center px-4 py-3">
          <span className="font-extrabold tracking-wider text-amber-500 text-sm uppercase">Sathonay Basket</span>
          
          <nav className="flex space-x-1.5 bg-slate-800 p-1.5 rounded-2xl text-base font-semibold border border-slate-700/60">
            <button 
              onClick={() => setActiveTab('INIT')}
              title="Configuration"
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${
                activeTab === 'INIT' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              ⚙️
            </button>

            <button 
              onClick={() => setActiveTab('MATCH')}
              title="Direct"
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${
                activeTab === 'MATCH' ? 'bg-blue-600 text-white shadow-md' : 'text-blue-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              🏀
            </button>

            <button 
              onClick={() => setActiveTab('STATS')}
              title="Statistiques"
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${
                activeTab === 'STATS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              📊
            </button>

            <button 
              onClick={() => setActiveTab('LOGS')}
              title="Historique"
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${
                activeTab === 'LOGS' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              🕒
            </button>
          </nav>
        </div>
      </header>

      <main className="p-4">
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
            {game.onCourtPlayerIds.length < 5 && (
              <div className="bg-rose-900/90 border border-rose-500 text-white p-3.5 rounded-2xl text-xs font-bold flex justify-between items-center animate-pulse">
                <span>⚠️ Il manque {5 - game.onCourtPlayerIds.length} joueuse(s) sur le terrain (suite à une 5ᵉ faute).</span>
                <button onClick={() => setIsSubbing(true)} className="bg-white text-rose-950 px-2.5 py-1 rounded-xl uppercase font-black text-[10px]">Faire entrer</button>
              </div>
            )}

            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 text-white p-4 rounded-3xl shadow-2xl flex justify-between items-center">
              <div className="text-center w-1/3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamHome}</p>
                <p className="text-4xl font-black text-amber-400 mt-1">{game.scoreHome}</p>
              </div>

              <div className="text-center w-1/3 border-x border-slate-800 px-2">
                <div className="flex items-center justify-center space-x-2">
                  <button 
                    onClick={() => setGame(prev => ({ ...prev, quarter: Math.max(1, prev.quarter - 1) }))}
                    className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-400 font-black text-xs border border-amber-500/30 flex items-center justify-center"
                  >
                    -
                  </button>
                  <span className="bg-slate-800 text-amber-400 border border-amber-500/30 text-[10px] font-black px-2.5 py-1 rounded-full uppercase">
                    Q{game.quarter}
                  </span>
                  <button 
                    onClick={() => setGame(prev => ({ ...prev, quarter: Math.min(4, prev.quarter + 1) }))}
                    className="w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-400 font-black text-xs border border-amber-500/30 flex items-center justify-center"
                  >
                    +
                  </button>
                </div>

                <p className="text-3xl font-mono font-bold mt-2 tracking-tight text-white">{formatTime(game.clockSeconds)}</p>
                <div className="flex justify-center space-x-1 mt-2">
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

              <div className="text-center w-1/3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamAway}</p>
                <p className="text-4xl font-black text-slate-300 mt-1">{game.scoreAway}</p>
                <div className="flex justify-center space-x-1 mt-1">
                  <button onClick={() => setGame({...game, scoreAway: Math.max(0, game.scoreAway - 1)})} className="text-xs text-slate-500 font-bold px-1.5 bg-slate-800 rounded">-</button>
                  <button onClick={() => setGame({...game, scoreAway: game.scoreAway + 1})} className="text-xs text-slate-300 font-bold px-1.5 bg-slate-800 rounded">+</button>
                </div>
              </div>
            </div>

            {!isSubbing ? (
              <button 
                onClick={() => setIsSubbing(true)}
                className="w-full bg-indigo-600/80 hover:bg-indigo-600 border border-indigo-400/30 text-white font-bold py-3 rounded-2xl shadow-md transition flex items-center justify-center space-x-2"
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
                    <p className="text-xs text-rose-400 font-bold mb-2">1. Cocher la / les joueuse(s) qui SORTE(NT) ({selectedOutIds.length}) :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => {
                        const isSelected = selectedOutIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => toggleSelectOut(p.id)}
                            className={`flex items-center space-x-2 p-2.5 rounded-xl border text-left text-xs transition ${
                              isSelected ? 'bg-rose-500/20 border-rose-500 text-white font-bold' : 'bg-slate-800 border-slate-700/60 text-slate-400'
                            }`}
                          >
                            <input type="checkbox" checked={isSelected} readOnly className="accent-rose-500" />
                            <span>#{p.number} {p.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-emerald-400 font-bold mb-2">2. Cocher joueuse(s) qui ENTRE(NT) ({selectedInIds.length}) :</p>
                    <div className="grid grid-cols-2 gap-2">
                      {game.roster.filter(p => !game.onCourtPlayerIds.includes(p.id)).map(p => {
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
                                ? 'bg-rose-950/40 border-rose-900/50 text-rose-500/50 cursor-not-allowed'
                                : isSelected 
                                  ? 'bg-emerald-500/20 border-emerald-500 text-white font-bold' 
                                  : 'bg-slate-800 border-slate-700/60 text-slate-400'
                            }`}
                          >
                            <div className="flex items-center space-x-2">
                              {!isFouledOut && <input type="checkbox" checked={isSelected} readOnly className="accent-emerald-500" />}
                              <span>#{p.number} {p.name}</span>
                            </div>
                            {isFouledOut && <span className="text-[10px] bg-rose-900/80 text-rose-200 px-1.5 py-0.5 rounded font-black">5 FAUTES (EXCLUE)</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedInIds.length > 0 && (
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
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider text-center">2. Sélectionner la joueuse</h3>
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
                        <div className="flex items-center space-x-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${fouls >= 4 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-slate-700 text-slate-400'}`}>
                            {fouls}/5 fautes
                          </span>
                        </div>
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
                        <td className={`py-3 px-2 text-center font-bold ${st.fouls >= 5 ? 'text-rose-500 font-black' : st.fouls >= 4 ? 'text-amber-400' : 'text-slate-300'}`}>
                          {st.fouls}/5
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