'use client';

import React from 'react';
import { GameState, ActionType } from '../types/basketball';

interface Props {
  game: GameState;
  setGame: React.Dispatch<React.SetStateAction<GameState | null>>;
  onSelectAction: (action: ActionType) => void;
  onOpenSubstitution: () => void;
}

export default function Screen1Court({ game, setGame, onSelectAction, onOpenSubstitution }: Props) {
  const totalOpponentScore = Object.values(game.scoreOpponentByQuarter).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* En-tête : Chrono & Scores */}
      <div className="bg-gray-900 text-white p-4 rounded-2xl shadow flex justify-between items-center">
        <div className="text-center">
          <p className="text-xs text-gray-400">SATHONAY</p>
          <p className="text-4xl font-extrabold">{game.scoreSathonay}</p>
        </div>

        <div className="text-center">
          <span className="bg-blue-600 text-xs px-2 py-1 rounded font-bold uppercase">Q{game.quarter}</span>
          <p className="text-2xl font-mono mt-1">
            {Math.floor(game.clockSeconds / 60).toString().padStart(2, '0')}:
            {(game.clockSeconds % 60).toString().padStart(2, '0')}
          </p>
        </div>

        <div className="text-center">
          <p className="text-xs text-gray-400">{game.opponentName}</p>
          <p className="text-4xl font-extrabold">{totalOpponentScore}</p>
        </div>
      </div>

      {/* Boutons Chrono / Changement */}
      <div className="grid grid-cols-2 gap-2">
        <button 
          onClick={() => setGame(g => g ? { ...g, isClockRunning: !g.isClockRunning } : null)}
          className={`py-3 font-bold text-lg rounded-xl text-white ${game.isClockRunning ? 'bg-amber-600' : 'bg-green-600'}`}
        >
          {game.isClockRunning ? 'PAUSE CHRONO' : 'REPRISE CHRONO'}
        </button>
        <button 
          onClick={onOpenSubstitution}
          className="py-3 font-bold text-lg rounded-xl bg-purple-600 text-white"
        >
          CHANGEMENT
        </button>
      </div>

      {/* Grille des actions */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onSelectAction('TIR_2PTS')} className="p-5 bg-blue-600 text-white text-xl font-black rounded-2xl shadow">TIR 2PTS</button>
        <button onClick={() => onSelectAction('TIR_3PTS')} className="p-5 bg-indigo-600 text-white text-xl font-black rounded-2xl shadow">TIR 3PTS</button>
        <button onClick={() => onSelectAction('LANCER_FRANC')} className="p-5 bg-teal-600 text-white text-xl font-black rounded-2xl shadow">LANCER FRANC</button>
        <button onClick={() => onSelectAction('REBOND')} className="p-5 bg-orange-600 text-white text-xl font-black rounded-2xl shadow">REBOND</button>
        <button onClick={() => onSelectAction('FAUTE')} className="p-5 bg-red-600 text-white text-xl font-black rounded-2xl shadow">FAUTE</button>
        
        {/* Actions Secondaires */}
        <div className="col-span-2 grid grid-cols-2 gap-2 pt-2">
          <button onClick={() => onSelectAction('PASSE_DECISIVE')} className="p-3 bg-gray-200 text-gray-800 font-bold rounded-xl">PASSE DÉCISIVE</button>
          <button onClick={() => onSelectAction('INTERCEPTION')} className="p-3 bg-gray-200 text-gray-800 font-bold rounded-xl">INTERCEPTION</button>
          <button onClick={() => onSelectAction('CONTRE')} className="p-3 bg-gray-200 text-gray-800 font-bold rounded-xl">CONTRE</button>
          <button onClick={() => onSelectAction('BALLE_PERDUE')} className="p-3 bg-gray-200 text-gray-800 font-bold rounded-xl">BALLE PERDUE</button>
        </div>
      </div>
    </div>
  );
}