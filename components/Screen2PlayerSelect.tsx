'use client';

import React from 'react';
import { Player, ActionType } from '../types/basketball';

interface Props {
  action: ActionType;
  onCourtPlayers: Player[];
  onSelectPlayer: (playerId: string) => void;
  onCancel: () => void;
}

export default function Screen2PlayerSelect({ action, onCourtPlayers, onSelectPlayer, onCancel }: Props) {
  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm">
        <span className="font-bold text-gray-500 uppercase">Action : {action.replace('_', ' ')}</span>
        <button onClick={onCancel} className="text-red-600 font-bold px-3 py-1 bg-red-50 rounded-lg">ANNULER</button>
      </div>

      <h2 className="text-lg font-black text-center">QUI A FAIT L'ACTION ?</h2>

      <div className="grid grid-cols-1 gap-3">
        {onCourtPlayers.map(p => (
          <button 
            key={p.id}
            onClick={() => onSelectPlayer(p.id)}
            className="flex items-center space-x-4 p-4 bg-white rounded-2xl shadow border-2 border-transparent active:border-blue-600 text-left"
          >
            <span className="w-12 h-12 flex items-center justify-center bg-blue-600 text-white rounded-xl text-2xl font-black">
              #{p.number}
            </span>
            <span className="text-xl font-bold text-gray-800">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}