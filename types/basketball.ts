export interface Player { id: string; number: number; name: string; }
export interface GameEvent { id: string; timestamp: string; quarter: number; clockTime: string; actionType: string; playerId: string; details?: any; }
export interface GameState {
  id: string;
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
