import { initialPosition, type Outcome, type Player, type Position } from '../rules/position';
import {
  CLASSIC_RULES,
  type PowerupsState,
  type DiceModifier,
  type RulesContext,
  type Ruleset,
} from '../variant/types';
import type { Phase } from './phase';
import type { GameClock } from '../clock';

export type OpeningState =
  | { status: 'PENDING' }
  | { status: 'RESOLVED'; attempts: [number, number][]; winner: Player };

export type GameState = Position & {
  phase: Phase;
  active: Player | null;
  remaining: number[];
  roll: number[];
  opening: OpeningState;
  outcome: Outcome | null;
  ruleset: Ruleset;
  variantConfigHash: string | null;
  powerups: PowerupsState | null;
  diceModifiers: DiceModifier[];
  rollSource: 'loadedKnuckles' | null;
  clock: GameClock | null;
};

export type Session = { state: GameState; history: GameState[] };

export function initialGameState(rules: RulesContext = CLASSIC_RULES): GameState {
  return {
    ...initialPosition(),
    phase: 'OPENING',
    active: 0,
    remaining: [],
    roll: [],
    opening: { status: 'PENDING' },
    outcome: null,
    ruleset: rules.ruleset,
    variantConfigHash: rules.variantConfig?.hash ?? null,
    powerups: rules.variantConfig ? initialPowerupsState() : null,
    diceModifiers: [],
    rollSource: null,
    clock: null,
  };
}

function initialPowerupsState(): PowerupsState {
  return {
    completedRounds: 0,
    actedThisRound: [false, false],
    loadouts: [
      { powerups: [], passives: [] },
      { powerups: [], passives: [] },
    ],
    activeEffects: [],
    passiveCounters: [{}, {}],
    passivePolicies: [{}, {}],
    powerupsUsedThisTurn: 0,
    checkerMovedThisTurn: false,
    nextAbilityInstance: 1,
    draft: null,
  };
}
