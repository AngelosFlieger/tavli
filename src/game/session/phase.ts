export type Phase =
  | 'OPENING'
  | 'WAITING_FOR_ROLL'
  | 'WAITING_FOR_MOVE'
  | 'TURN_COMPLETE'
  | 'DRAFT_ORDER'
  | 'DRAFT_PICK'
  | 'GAME_OVER';

export const PHASES: readonly Phase[] = [
  'OPENING',
  'WAITING_FOR_ROLL',
  'WAITING_FOR_MOVE',
  'TURN_COMPLETE',
  'DRAFT_ORDER',
  'DRAFT_PICK',
  'GAME_OVER',
];

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && PHASES.includes(value as Phase);
}

export type PhaseAction =
  | 'beginRoll'
  | 'openingComplete'
  | 'rollReady'
  | 'movesExhausted'
  | 'gameFinished'
  | 'endTurn';

const transitions: Record<Phase, Partial<Record<PhaseAction, Phase>>> = {
  OPENING: {
    openingComplete: 'WAITING_FOR_ROLL',
  },
  WAITING_FOR_ROLL: {
    beginRoll: 'WAITING_FOR_ROLL',
    rollReady: 'WAITING_FOR_MOVE',
  },
  WAITING_FOR_MOVE: {
    movesExhausted: 'TURN_COMPLETE',
    gameFinished: 'GAME_OVER',
  },
  TURN_COMPLETE: { endTurn: 'WAITING_FOR_ROLL' },
  DRAFT_ORDER: {},
  DRAFT_PICK: {},
  GAME_OVER: {},
};

export function nextPhase(phase: Phase, action: PhaseAction): Phase | null {
  return transitions[phase][action] ?? null;
}

export function canUndoInPhase(phase: Phase): boolean {
  return phase === 'WAITING_FOR_MOVE' || phase === 'TURN_COMPLETE';
}
