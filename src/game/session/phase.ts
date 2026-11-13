export type Phase =
  | 'OPENING_ROLL'
  | 'WAITING_FOR_ROLL'
  | 'WAITING_FOR_MOVE'
  | 'TURN_COMPLETE'
  | 'GAME_OVER';

export type PhaseAction =
  | 'beginRoll'
  | 'needOpeningRoll'
  | 'openingComplete'
  | 'rollReady'
  | 'movesExhausted'
  | 'gameFinished'
  | 'endTurn';

const transitions: Record<Phase, Partial<Record<PhaseAction, Phase>>> = {
  OPENING_ROLL: {
    beginRoll: 'OPENING_ROLL',
    needOpeningRoll: 'OPENING_ROLL',
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
  GAME_OVER: {},
};

export function nextPhase(phase: Phase, action: PhaseAction): Phase | null {
  return transitions[phase][action] ?? null;
}

export function canUndoInPhase(phase: Phase): boolean {
  return phase === 'WAITING_FOR_MOVE' || phase === 'TURN_COMPLETE';
}
