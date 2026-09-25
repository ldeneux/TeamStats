'use client';

import React, { useState } from 'react';
import { GameState, ActionType, GameEvent } from '../types/basketball';
import Screen0Import from '../components/Screen0Import';
import Screen1Court from '../components/Screen1Court';
import Screen2PlayerSelect from '../components/Screen2PlayerSelect';
import Screen3Detail from '../components/Screen3Detail';

export default function MatchTracker() {
  const [game, setGame] = useState<GameState | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isSubstituteOpen, setIsSubstituteOpen] = useState(false);

  if (!game) {
    return <Screen0Import onSelectGame={(g) => setGame(g)} />;
  }

  // Étape 1 -> Étape 2
  const handleActionSelect = (action: ActionType) => {
    setSelectedAction(action);
    setStep(2);
  };

  // Étape 2 -> Étape 3 (ou validation directe pour actions simples)
  const handlePlayerSelect = (playerId: string) => {
    setSelectedPlayerId(playerId);

    const directActions: ActionType[] = ['INTERCEPTION', 'CONTRE', 'BALLE_PERDUE', 'PASSE_DECISIVE'];
    if (selectedAction && directActions.includes(selectedAction)) {
      saveEvent({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        quarter: game.quarter,
        clockTime: formatTime(game.clockSeconds),
        actionType: selectedAction,
        playerId: playerId
      });
      resetFlow();
    } else {
      setStep(3);
    }
  };

  const saveEvent = (event: GameEvent) => {
    let scoreInc = 0;
    if (event.actionType === 'TIR_2PTS' && event.details?.made) scoreInc = 2;
    if (event.actionType === 'TIR_3PTS' && event.details?.made) scoreInc = 3;
    if (event.actionType === 'LANCER_FRANC' && event.details?.made) scoreInc = 1;

    setGame(prev => prev ? {
      ...prev,
      scoreSathonay: prev.scoreSathonay + scoreInc,
      events: [event, ...prev.events]
    } : null);
  };

  const handleSubstitution = (outId: string, inId: string) => {
    setGame(prev => {
      if (!prev) return null;
      return {
        ...prev,
        onCourtPlayerIds: prev.onCourtPlayerIds.map(id => id === outId ? inId : id),
        benchPlayerIds: prev.benchPlayerIds.map(id => id === inId ? outId : id)
      };
    });
    setIsSubstituteOpen(false);
  };

  const resetFlow = () => {
    setStep(1);
    setSelectedAction(null);
    setSelectedPlayerId(null);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-100 p-2 sm:p-4">
      {step === 1 && (
        <Screen1Court 
          game={game} 
          setGame={setGame} 
          onSelectAction={handleActionSelect} 
          onOpenSubstitution={() => setIsSubstituteOpen(true)}
        />
      )}

      {step === 2 && selectedAction && (
        <Screen2PlayerSelect 
          action={selectedAction}
          onCourtPlayers={game.roster.filter(p => game.onCourtPlayerIds.includes(p.id))}
          onSelectPlayer={handlePlayerSelect}
          onCancel={resetFlow}
        />
      )}

      {step === 3 && selectedAction && selectedPlayerId && (
        <Screen3Detail 
          action={selectedAction}
          player={game.roster.find(p => p.id === selectedPlayerId)!}
          onSave={(details) => {
            saveEvent({
              id: Date.now().toString(),
              timestamp: new Date().toISOString(),
              quarter: game.quarter,
              clockTime: formatTime(game.clockSeconds),
              actionType: selectedAction,
              playerId: selectedPlayerId,
              details
            });
            resetFlow();
          }}
          onCancel={resetFlow}
        />
      )}

      {/* Modal Changement */}
      {isSubstituteOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-2xl max-w-md w-full space-y-4">
            <h2 className="text-xl font-bold">Changement</h2>
            <p className="text-sm text-gray-500">Choisissez la joueuse sortante puis l'entrante.</p>
            
            <div>
              <h3 className="text-xs font-bold text-red-500 uppercase mb-2">1. Joueuse Sortante (Sur le terrain)</h3>
              <div className="grid grid-cols-2 gap-2">
                {game.roster.filter(p => game.onCourtPlayerIds.includes(p.id)).map(p => (
                  <button key={p.id} onClick={() => {
                    const inId = game.benchPlayerIds[0];
                    if (inId) handleSubstitution(p.id, inId);
                  }} className="p-3 border rounded-xl font-bold text-left bg-red-50">
                    #{p.number} {p.name}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => setIsSubstituteOpen(false)} className="w-full py-3 bg-gray-200 font-bold rounded-xl">
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}