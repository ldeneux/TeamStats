export type ActionType = 
  | 'TIR_2PTS' 
  | 'TIR_3PTS' 
  | 'LANCER_FRANC' 
  | 'REBOND' 
  | 'FAUTE' 
  | 'INTERCEPTION' 
  | 'CONTRE' 
  | 'BALLE_PERDUE' 
  | 'PASSE_DECISIVE';

export interface Player {
  id: string;
  number: number;
  name: string;
}

export interface GameEvent {
  id: string;
  timestamp: string;
  quarter: number;
  clockTime: string;
  actionType: ActionType;
  playerId: string;
  details?: {
    made?: boolean;
    freeThrowIndex?: number;
    freeThrowTotal?: number;
    reboundType?: 'OFFENSIF' | 'DEFENSIF';
    foulType?: 'PERSONNELLE' | 'P1' | 'P2' | 'P3' | 'TECHNIQUE' | 'ANTISPORTIVE';
  };
}

export interface GameState {
  id: string;
  opponentName: string;
  matchDate: string;
  location: string;
  quarter: number;
  clockSeconds: number;
  isClockRunning: boolean;
  scoreSathonay: number;
  scoreOpponentByQuarter: { [quarter: number]: number };
  onCourtPlayerIds: string[];
  benchPlayerIds: string[];
  roster: Player[];
  events: GameEvent[];
}