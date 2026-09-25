'use client';

import React, { useState } from 'react';
import { GameState, Player } from '../types/basketball';

const MOCK_SATHONAY_ROSTER: Player[] = [
  { id: '1', number: 4, name: 'S. MARTIN' },
  { id: '2', number: 7, name: 'L. DUBOIS' },
  { id: '3', number: 9, name: 'C. BERNARD' },
  { id: '4', number: 10, name: 'E. THOMAS' },
  { id: '5', number: 12, name: 'M. ROBERT' },
  { id: '6', number: 14, name: 'A. RICHARD' },
  { id: '7', number: 15, name: 'JULIE P.' },
];

interface Props {
  onSelectGame: (game: GameState) => void;
}

export default function Screen0Import({ onSelectGame }: Props) {
  const [url, setUrl] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>(['1', '2', '3', '4', '5']);
  const [starters, setStarters] = useState<string[]>(['1', '2', '3', '4', '5']);

  const handleImport = (e: React.FormEvent) => {
    e.preventDefault();
    const newGame: GameState = {
      id: Date.now().toString(),
      opponentName: 'ASVEL Féminin U18',
      matchDate: '2026-10-15 15:30',
      location: 'Gymnase de Sathonay',
      quarter: 1,
      clockSeconds: 600,
      isClockRunning: false,
      scoreSathonay: 0,
      scoreOpponentByQuarter: { 1: 0, 2: 0, 3: 0, 4: 0 },
      roster: MOCK_SATHONAY_ROSTER.filter(p => selectedPlayers.includes(p.id)),
      onCourtPlayerIds: starters,
      benchPlayerIds: selectedPlayers.filter(id => !starters.includes(id)),
      events: []
    };
    onSelectGame(newGame);
  };

  const toggleStarter = (id: string) => {
    if (starters.includes(id)) {
      setStarters(starters.filter(item => item !== id));
    } else if (starters.length < 5) {
      setStarters([...starters, id]);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold text-center">Écran 0 — Import du match</h1>
      
      <form onSubmit={handleImport} className="space-y-4 border p-4 rounded-xl shadow-sm bg-white">
        <div>
          <label className="block text-sm font-medium mb-1">URL FFBB du match</label>
          <input 
            type="url" 
            required 
            placeholder="https://.../match/200000014737720"
            className="w-full border p-2 rounded-lg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="bg-gray-50 p-3 rounded-lg text-sm space-y-1">
          <p><strong>Équipe adverse résolue :</strong> ASVEL Féminin U18</p>
          <p><strong>Date & Heure :</strong> Samedi 15 Oct 2026 — 15h30</p>
          <p><strong>Lieu :</strong> Gymnase de Sathonay</p>
        </div>

        <div>
          <h3 className="font-semibold mb-2">1. Joueuses convoquées ({selectedPlayers.length})</h3>
          <div className="grid grid-cols-2 gap-2">
            {MOCK_SATHONAY_ROSTER.map(p => (
              <label key={p.id} className="flex items-center space-x-2 border p-2 rounded">
                <input 
                  type="checkbox" 
                  checked={selectedPlayers.includes(p.id)}
                  onChange={() => {
                    if (selectedPlayers.includes(p.id)) {
                      setSelectedPlayers(selectedPlayers.filter(id => id !== p.id));
                      setStarters(starters.filter(id => id !== p.id));
                    } else {
                      setSelectedPlayers([...selectedPlayers, p.id]);
                    }
                  }}
                />
                <span>#{p.number} {p.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">2. Cinq titulaire (Sélectionnez 5)</h3>
          <div className="flex wrap gap-2">
            {selectedPlayers.map(id => {
              const p = MOCK_SATHONAY_ROSTER.find(item => item.id === id);
              const isStarter = starters.includes(id);
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => toggleStarter(id)}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border ${isStarter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  #{p?.number}
                </button>
              );
            })}
          </div>
        </div>

        <button 
          type="submit" 
          disabled={starters.length !== 5}
          className="w-full bg-green-600 text-white py-3 rounded-xl font-bold disabled:bg-gray-300"
        >
          Lancer / Préparer ce match
        </button>
      </form>
    </div>
  );
}