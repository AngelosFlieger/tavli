import type { GameState, Move, Player } from '../game/engine';

export type Command =
  | { type: 'roll' }
  | { type: 'move'; sequence: Move[] }
  | { type: 'undo' }
  | { type: 'end' }
  | { type: 'restart' };

export type ClientPacket = { type: 'find' } | { type: 'cancel' } | Command;

export type Update = {
  state: GameState;
  canUndo: boolean;
  dice?: [number, number];
  sequence?: Move[];
  resetDice?: boolean;
};

export type ServerMessage =
  | { type: 'ready'; name: string }
  | { type: 'rejected' }
  | { type: 'waiting' }
  | { type: 'matched'; you: Player; state: GameState }
  | { type: 'resume'; you: Player; state: GameState; canUndo: boolean }
  | ({ type: 'update' } & Update)
  | { type: 'left' };

export function isCommand(value: unknown): value is Command {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; sequence?: unknown };
  if (
    message.type === 'roll' ||
    message.type === 'undo' ||
    message.type === 'end' ||
    message.type === 'restart'
  )
    return true;
  if (message.type !== 'move' || !Array.isArray(message.sequence) || !message.sequence.length)
    return false;
  return message.sequence.every((step) => {
    if (!step || typeof step !== 'object') return false;
    const move = step as Move;
    return (
      Number.isInteger(move.from) &&
      Number.isInteger(move.to) &&
      Number.isInteger(move.die) &&
      move.die >= 1 &&
      move.die <= 6
    );
  });
}
