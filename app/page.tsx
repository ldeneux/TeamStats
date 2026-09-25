'use client';

import React, { useState, useEffect } from 'react';
import { GameState, Player, GameEvent } from '../types/basketball';

const DEFAULT_PLAYERS: Player[] = [
  { id: '1', number: 4, name: 'S. MARTIN' },
  { id: '2', number: 7, name: 'L. DUBOIS' },
  { id: '3', number: 9, name: 'C. BERNARD' },
  { id: '4', number: 10, name: 'E. THOMAS' },
  { id: '5', number: 12, name: 'M. ROBERT' },
  { id: '6', number: 14, name: 'A. RICHARD' },
  { id: '7', number: 15, name: 'J. PETIT' },
  { id: '8', number: 18, name: 'M. DURAND' },
  { id: '9', number: 21, name: 'C. MOREAU' },
  { id: '10', number: 23, name: 'E. LEROY' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'INIT' | 'MATCH' | 'LOGS'>('INIT');
  
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

  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // Décompte chrono
  useEffect(() => {
    let timer: any;
    if (game.isClockRunning && game.clockSeconds > 0) {
      timer = setInterval(() => {
        setGame(prev => ({ ...prev, clockSeconds: prev.clockSeconds - 1 }));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [game.isClockRunning, game.clockSeconds]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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

    setGame(prev => ({
      ...prev,
      scoreHome: prev.scoreHome + points,
      events: [newEvent, ...prev.events]
    }));

    setSelectedAction(null);
    setSelectedPlayerId(null);
  };

  return (
    <div className="max-w-2xl mx-auto min-h-screen pb-12">
      {/* MENU SUPÉRIEUR */}
      <header className="bg-slate-900/90 backdrop-blur-md text-white sticky top-0 z-50 border-b border-slate-700/50 shadow-lg">
        <div className="flex justify-between items-center px-4 py-3">
          <span className="font-extrabold tracking-wider text-amber-500 text-sm uppercase">Sathonay Basket</span>
          <nav className="flex space-x-1 bg-slate-800 p-1 rounded-xl text-xs font-semibold">
            <button 
              onClick={() => setActiveTab('INIT')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'INIT' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Configuration
            </button>
            <button 
              onClick={() => setActiveTab('MATCH')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'MATCH' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Direct
            </button>
            <button 
              onClick={() => setActiveTab('LOGS')}
              className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'LOGS' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Historique
            </button>
          </nav>
        </div>
      </header>

      <main className="p-4">
        {/* ONGLET 1 : CONFIGURATION */}
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
                <label className="text-xs font-semibold text-slate-400">Composition : 10 Joueuses (Cliquer pour sélectionner le 5 majeur)</label>
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

        {/* ONGLET 2 : DIRECT / TERRAIN */}
        {activeTab === 'MATCH' && (
          <div className="space-y-4">
            {/* SCOREBOARD & CHRONO */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 text-white p-4 rounded-3xl shadow-2xl flex justify-between items-center">
              <div className="text-center w-1/3">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{game.teamHome}</p>
                <p className="text-4xl font-black text-amber-400 mt-1">{game.scoreHome}</p>
              </div>

              <div className="text-center w-1/3 border-x border-slate-800 px-2">
                <span className="bg-slate-800 text-amber-400 border border-amber-500/30 text-[10px] font-black px-2.5 py-1 rounded-full uppercase">
                  Quart-temps {game.quarter}
                </span>
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

            {/* SELECTION ACTION OU JOUEUSE */}
            {!selectedAction ? (
              <div className="bg-slate-900/80 backdrop-blur-md border border-white/10 p-4 rounded-3xl shadow-xl space-y-3">
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider text-center">1. Choisir l'action</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <button onClick={() => setSelectedAction('TIR 2PTS')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">TIR 2PTS</button>
                  <button onClick={() => setSelectedAction('TIR 3PTS')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">TIR 3PTS</button>
                  <button onClick={() => setSelectedAction('LANCER FRANC')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">LANCER FRANC</button>
                  <button onClick={() => setSelectedAction('REBOND')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">REBOND</button>
                  <button onClick={() => setSelectedAction('FAUTE')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">FAUTE</button>
                  <button onClick={() => setSelectedAction('PASSE DÉCISIVE')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm rounded-2xl border border-slate-700/80 shadow">PASSE DEC.</button>
                </div>
              </div>
            ) : !selectedPlayerId ? (
              <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-4 rounded-3xl shadow-xl space-y-3">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold text-amber-400 uppercase">Action : {selectedAction}</span>
                  <button onClick={() => setSelectedAction(null)} className="text-xs text-rose-400 font-bold">ANNULER</button>
                </div>
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider text-center">2. Sélectionner la joueuse sur le terrain</h3>
                <div className="space-y-2">
                  {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => (
                    <button 
                      key={p.id} 
                      onClick={() => setSelectedPlayerId(p.id)} 
                      className="w-full flex items-center justify-between p-3.5 bg-slate-800 border border-slate-700/80 rounded-2xl text-white hover:bg-slate-700 transition"
                    >
                      <span className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black text-sm">#{p.number}</span>
                      <span className="font-bold text-sm">{p.name}</span>
                      <span className="text-xs text-slate-500 font-medium">Sur le terrain</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/90 backdrop-blur-md border border-white/10 p-5 rounded-3xl shadow-xl space-y-4 text-center">
                <h3 className="text-sm font-bold text-amber-400 uppercase">3. Résultat de l'action</h3>
                <p className="text-xs text-slate-300">
                  {selectedAction} par <strong className="text-white">#{game.roster.find(p => p.id === selectedPlayerId)?.number} {game.roster.find(p => p.id === selectedPlayerId)?.name}</strong>
                </p>

                {selectedAction?.includes('TIR') || selectedAction === 'LANCER FRANC' ? (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <button 
                      onClick={() => recordEvent(selectedAction, selectedPlayerId, selectedAction === 'TIR 3PTS' ? 3 : selectedAction === 'TIR 2PTS' ? 2 : 1)}
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
                  Annuler et revenir
                </button>
              </div>
            )}
          </div>
        )}

        {/* ONGLET 3 : HISTORIQUE */}
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
                    <div key={ev.id} className="flex justify-between items-center p-3 bg-slate-800/70 border border-slate-700/50 rounded-xl text-xs">
                      <div>
                        <span className="font-mono text-amber-400 font-bold mr-2">[{ev.clockTime}]</span>
                        <span className="font-bold text-white">#{player?.number} {player?.name}</span>
                      </div>
                      <span className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded font-semibold">{ev.actionType}</span>
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