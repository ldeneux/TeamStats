'use client';

import React, { useState } from 'react';
import { ActionType, Player } from '../types/basketball';

interface Props {
  action: ActionType;
  player: Player;
  onSave: (details: any) => void;
  onCancel: () => void;
}

export default function Screen3Detail({ action, player, onSave, onCancel }: Props) {
  const [ftTotal, setFtTotal] = useState<number>(1);
  const [ftResults, setFtResults] = useState<boolean[]>([]);

  return (
    <div className="max-w-md mx-auto space-y-6 p-2">
      <div className="bg-white p-4 rounded-xl shadow text-center">
        <p className="text-sm text-gray-500">#{player.number} - {player.name}</p>
        <h2 className="text-2xl font-black mt-1">{action.replace('_', ' ')}</h2>
      </div>

      {/* TIR 2PTS / 3PTS */}
      {(action === 'TIR_2PTS' || action === 'TIR_3PTS') && (
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={() => onSave({ made: true })} 
            className="p-8 bg-green-600 text-white font-black text-2xl rounded-2xl shadow"
          >
            RÉUSSI
          </button>
          <button 
            onClick={() => onSave({ made: false })} 
            className="p-8 bg-red-600 text-white font-black text-2xl rounded-2xl shadow"
          >
            MANQUÉ
          </button>
        </div>
      )}

      {/* REBOND */}
      {action === 'REBOND' && (
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={() => onSave({ reboundType: 'OFFENSIF' })} 
            className="p-8 bg-orange-500 text-white font-black text-xl rounded-2xl shadow"
          >
            OFFENSIF
          </button>
          <button 
            onClick={() => onSave({ reboundType: 'DEFENSIF' })} 
            className="p-8 bg-blue-600 text-white font-black text-xl rounded-2xl shadow"
          >
            DÉFENSIF
          </button>
        </div>
      )}

      {/* FAUTE */}
      {action === 'FAUTE' && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => onSave({ foulType: 'PERSONNELLE' })} className="p-4 bg-gray-800 text-white font-bold rounded-xl">PERSONNELLE</button>
          <button onClick={() => onSave({ foulType: 'P1' })} className="p-4 bg-red-600 text-white font-bold rounded-xl">P1 (1 LF)</button>
          <button onClick={() => onSave({ foulType: 'P2' })} className="p-4 bg-red-600 text-white font-bold rounded-xl">P2 (2 LF)</button>
          <button onClick={() => onSave({ foulType: 'P3' })} className="p-4 bg-red-600 text-white font-bold rounded-xl">P3 (3 LF)</button>
        </div>
      )}

      {/* LANCER FRANC */}
      {action === 'LANCER_FRANC' && (
        <div className="space-y-4">
          <div className="flex justify-center space-x-2">
            {[1, 2, 3].map(n => (
              <button 
                key={n} 
                onClick={() => { setFtTotal(n); setFtResults([]); }} 
                className={`px-4 py-2 font-bold rounded-lg ${ftTotal === n ? 'bg-black text-white' : 'bg-gray-200'}`}
              >
                {n} LF
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => {
                const updated = [...ftResults, true];
                if (updated.length === ftTotal) onSave({ made: updated.filter(Boolean).length > 0 });
                else setFtResults(updated);
              }} 
              className="p-6 bg-green-600 text-white font-black text-xl rounded-2xl"
            >
              RÉUSSI ({ftResults.length + 1}/{ftTotal})
            </button>
            <button 
              onClick={() => {
                const updated = [...ftResults, false];
                if (updated.length === ftTotal) onSave({ made: updated.filter(Boolean).length > 0 });
                else setFtResults(updated);
              }} 
              className="p-6 bg-red-600 text-white font-black text-xl rounded-2xl"
            >
              MANQUÉ ({ftResults.length + 1}/{ftTotal})
            </button>
          </div>
        </div>
      )}

      <button onClick={onCancel} className="w-full py-4 bg-gray-300 font-bold rounded-xl text-gray-700">
        ANNULER ET RETOURNER AU TERRAIN
      </button>
    </div>
  );
}