import { initialPosition, type Outcome, type Player, type Position } from '../rules/position';
import type { Phase } from './phase';

export type GameState = Position & {
  phase: Phase;
  active: Player | null;
  remaining: number[];
  roll: number[];
  openingRolls: [number[] | null, number[] | null];
  outcome: Outcome | null;
  message: string;
  opening: boolean;
};

export type Session = { state: GameState; history: GameState[] };

export function initialGameState(): GameState {
  return {
    ...initialPosition(),
    phase: 'OPENING_ROLL',
    active: 0,
    remaining: [],
    roll: [],
    openingRolls: [null, null],
    outcome: null,
    message: '',
    opening: true,
  };
}
