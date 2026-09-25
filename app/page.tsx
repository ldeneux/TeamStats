'use client';

import React, { useState } from 'react';
import { GameState, ActionType, GameEvent, Player } from '../types/basketball';

const MOCK_ROSTER: Player[] = [
  { id: '1', number: 4, name: 'S. MARTIN' },
  { id: '2', number: 7, name: 'L. DUBOIS' },
  { id: '3', number: 9, name: 'C. BERNARD' },
  { id: '4', number: 10, name: 'E. THOMAS' },
  { id: '5', number: 12, name: 'M. ROBERT' },
  { id: '6', number: 14, name: 'A. RICHARD' },
  { id: '7', number: 15, name: 'JULIE P.' },
];

export default function MatchTracker() {
  const [game, setGame] = useState<GameState | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  if (!game) {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-6 pt-10">
        <h1 className="text-2xl font-black text-center uppercase tracking-wide">Sathonay Basket — Import Match</h1>
        <div className="bg-white p-6 rounded-2xl shadow space-y-4 border">
          <div>
            <label className="block text-sm font-bold mb-1">URL FFBB du match</label>
            <input 
              type="url" 
              placeholder="https://.../match/200000014737720"
              className="w-full border p-3 rounded-xl bg-gray-50"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="bg-blue-50 p-3 rounded-xl text-xs space-y-1 text-blue-900 font-medium">
            <p>✔ Équipe Sathonay reconnue</p>
            <p>✔ Adversaire : ASVEL Féminin U18</p>
            <p>✔ Gymnase de Sathonay — Samedi 15:30</p>
          </div>
          <button 
            onClick={() => setGame({
              id: '1',
              opponentName: 'ASVEL U18',
              matchDate: '15/10/2026',
              location: 'Sathonay',
              quarter: 1,
              clockSeconds: 600,
              isClockRunning: false,
              scoreSathonay: 0,
              scoreOpponentByQuarter: { 1: 0, 2: 0, 3: 0, 4: 0 },
              roster: MOCK_ROSTER,
              onCourtPlayerIds: ['1', '2', '3', '4', '5'],
              benchPlayerIds: ['6', '7'],
              events: []
            })}
            className="w-full bg-green-600 text-white font-black py-4 rounded-xl text-lg shadow-lg hover:bg-green-700 transition"
          >
            LANCER LE MATCH
          </button>
        </div>
      </div>
    );
  }

  const handleAction = (act: ActionType) => {
    setSelectedAction(act);
    setStep(2);
  };

  const handlePlayer = (pId: string) => {
    setSelectedPlayerId(pId);
    if (['INTERCEPTION', 'CONTRE', 'BALLE_PERDUE', 'PASSE_DECISIVE'].includes(selectedAction!)) {
      setStep(1);
    } else {
      setStep(3);
    }
  };

  const onCourtPlayers = game.roster.filter(p => game.onCourtPlayerIds.includes(p.id));

  return (
    <div className="max-w-md mx-auto p-3 space-y-4 min-h-screen">
      {/* ÉCRAN 1 — TERRAIN */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-gray-900 text-white p-4 rounded-2xl flex justify-between items-center shadow-lg">
            <div className="text-center">
              <p className="text-xs text-gray-400 font-bold">SATHONAY</p>
              <p className="text-4xl font-black">{game.scoreSathonay}</p>
            </div>
            <div className="text-center">
              <span className="bg-blue-600 text-xs px-2 py-0.5 rounded font-black">Q{game.quarter}</span>
              <p className="text-2xl font-mono font-bold mt-1">10:00</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-400 font-bold">{game.opponentName}</p>
              <p className="text-4xl font-black">0</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button className="py-3 font-black bg-amber-500 text-white rounded-xl shadow">PAUSE CHRONO</button>
            <button className="py-3 font-black bg-purple-600 text-white rounded-xl shadow">CHANGEMENT</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => handleAction('TIR_2PTS')} className="p-5 bg-blue-600 text-white text-xl font-black rounded-2xl shadow">TIR 2PTS</button>
            <button onClick={() => handleAction('TIR_3PTS')} className="p-5 bg-indigo-600 text-white text-xl font-black rounded-2xl shadow">TIR 3PTS</button>
            <button onClick={() => handleAction('LANCER_FRANC')} className="p-5 bg-teal-600 text-white text-xl font-black rounded-2xl shadow">LANCER FRANC</button>
            <button onClick={() => handleAction('REBOND')} className="p-5 bg-orange-600 text-white text-xl font-black rounded-2xl shadow">REBOND</button>
            <button onClick={() => handleAction('FAUTE')} className="p-5 bg-red-600 text-white text-xl font-black rounded-2xl shadow">FAUTE</button>
            <button onClick={() => handleAction('PASSE_DECISIVE')} className="p-5 bg-gray-700 text-white text-xl font-black rounded-2xl shadow">PASSE DEC.</button>
          </div>
        </div>
      )}

      {/* ÉCRAN 2 — JOUEUSE */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm">
            <span className="font-bold text-gray-500 uppercase">{selectedAction}</span>
            <button onClick={() => setStep(1)} className="text-red-600 font-bold px-3 py-1 bg-red-50 rounded-lg">ANNULER</button>
          </div>
          <h2 className="text-lg font-black text-center">QUI A FAIT L'ACTION ?</h2>
          <div className="space-y-2">
            {onCourtPlayers.map(p => (
              <button key={p.id} onClick={() => handlePlayer(p.id)} className="w-full flex items-center space-x-4 p-4 bg-white rounded-2xl shadow border">
                <span className="w-12 h-12 flex items-center justify-center bg-blue-600 text-white rounded-xl text-2xl font-black">#{p.number}</span>
                <span className="text-xl font-bold">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ÉCRAN 3 — DÉTAIL */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl shadow text-center">
            <h2 className="text-2xl font-black">{selectedAction}</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={() => { setGame({...game, scoreSathonay: game.scoreSathonay + 2}); setStep(1); }} className="p-8 bg-green-600 text-white font-black text-2xl rounded-2xl shadow">RÉUSSI</button>
            <button onClick={() => setStep(1)} className="p-8 bg-red-600 text-white font-black text-2xl rounded-2xl shadow">MANQUÉ</button>
          </div>
          <button onClick={() => setStep(1)} className="w-full py-4 bg-gray-300 font-bold rounded-xl">ANNULER</button>
        </div>
      )}
    </div>
  );
}