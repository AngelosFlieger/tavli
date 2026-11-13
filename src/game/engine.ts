export { outcome } from './rules/outcome';
export { legalMoves, moveSequences, rawMoves } from './rules/moves';
export { applyMove, canBearOff, initialPosition, other, owner, pinned } from './rules/position';
export type { Move, Outcome, Player, Position } from './rules/position';
export { Game } from './session/game';
export type { GameState } from './session/game';
export type { Phase } from './session/phase';
