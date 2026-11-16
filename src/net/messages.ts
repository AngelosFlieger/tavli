import type { GameState, Move, Player } from '../game/engine';
import type { SessionEvent } from '../game/session/transition';
import {
  ABILITY_IDS,
  type AbilityActivation,
  type AbilityId,
  type ResolvedVariantConfig,
} from '../game/variant/types';
import { isVariantProfileId } from '../game/variant/config/profiles';
import type { VariantRulesSelection } from '../game/variant/rules-context';

export type MatchSelection = VariantRulesSelection;

export const CLASSIC_SELECTION: MatchSelection = Object.freeze({ ruleset: 'CLASSIC' });

export const PROTOCOL_VERSION = 1;

export type ClientErrorCode =
  | 'PROTOCOL'
  | 'AUTH'
  | 'NOT_FOUND'
  | 'NOT_YOUR_TURN'
  | 'MATCH_ENDED'
  | 'MATCH_NOT_FINISHED'
  | 'WAITING_FOR_OPPONENT'
  | 'INVALID_COMMAND'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_OWNED'
  | 'ROOM_CLOSED'
  | 'INTERNAL';

export type Command =
  | { type: 'roll' }
  | { type: 'move'; sequence: Move[] }
  | { type: 'undo' }
  | { type: 'end'; ability?: AbilityActivation }
  | { type: 'restart' }
  | { type: 'forfeit' }
  | { type: 'playAbility'; activation: AbilityActivation }
  | { type: 'pickAbility'; abilityId: AbilityId; replaceInstanceId?: string };

export type ClientPacket =
  | { type: 'hello'; protocol: number }
  | { type: 'find'; selection: MatchSelection }
  | { type: 'createRoom'; selection: MatchSelection }
  | { type: 'joinRoom'; code: string }
  | { type: 'cancel' }
  | Command;

export type Update = {
  state: GameState;
  canUndo: boolean;
  events?: SessionEvent[];
  dice?: [number, number];
  rerolledDie?: 0 | 1;
  sequence?: Move[];
  resetDice?: boolean;
};

export type ServerMessage =
  | { type: 'ready'; protocol: number; name: string }
  | { type: 'rejected'; reason?: 'AUTH' | 'PROTOCOL' }
  | { type: 'error'; code: ClientErrorCode }
  | { type: 'waiting' }
  | { type: 'room'; code: string }
  | {
      type: 'matched';
      you: Player;
      state: GameState;
      variantConfig: ResolvedVariantConfig | null;
    }
  | {
      type: 'resume';
      you: Player;
      state: GameState;
      canUndo: boolean;
      variantConfig: ResolvedVariantConfig | null;
    }
  | ({ type: 'update' } & Update)
  | { type: 'rematch'; status: 'OFFERED' | 'DECLINED' }
  | { type: 'left' };

export function isHello(value: unknown): value is { type: 'hello'; protocol: number } {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; protocol?: unknown };
  return message.type === 'hello' && Number.isInteger(message.protocol);
}

export function isProtocolCompatible(value: number): boolean {
  return value === PROTOCOL_VERSION;
}

export function isCommand(value: unknown): value is Command {
  if (!value || typeof value !== 'object') return false;
  const message = value as {
    type?: unknown;
    sequence?: unknown;
    abilityId?: unknown;
    replaceInstanceId?: unknown;
    ability?: unknown;
    activation?: unknown;
  };
  if (message.type === 'roll' || message.type === 'undo' || message.type === 'restart') return true;
  if (message.type === 'forfeit') return true;
  if (message.type === 'end')
    return message.ability === undefined || isAbilityActivation(message.ability);
  if (message.type === 'playAbility') return isAbilityActivation(message.activation);
  if (message.type === 'pickAbility')
    return (
      typeof message.abilityId === 'string' &&
      ABILITY_IDS.includes(message.abilityId as AbilityId) &&
      (message.replaceInstanceId === undefined || typeof message.replaceInstanceId === 'string')
    );
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

function isAbilityActivation(value: unknown): value is AbilityActivation {
  if (!value || typeof value !== 'object') return false;
  const activation = value as { instanceId?: unknown; target?: unknown; option?: unknown };
  if (
    typeof activation.instanceId !== 'string' ||
    !activation.target ||
    typeof activation.target !== 'object'
  )
    return false;
  if (
    activation.option !== undefined &&
    activation.option !== 'INCREASE' &&
    activation.option !== 'DECREASE'
  )
    return false;
  const target = activation.target as {
    type?: unknown;
    player?: unknown;
    point?: unknown;
    checker?: unknown;
    index?: unknown;
    instanceId?: unknown;
  };
  if (target.type === 'PLAYER') return target.player === 0 || target.player === 1;
  if (target.type === 'POINT')
    return Number.isInteger(target.point) && Number(target.point) >= 0 && Number(target.point) < 24;
  if (target.type === 'CHECKER')
    return (
      Number.isInteger(target.checker) && Number(target.checker) >= 0 && Number(target.checker) < 30
    );
  if (target.type === 'DIE') return target.index === 0 || target.index === 1;
  if (target.type === 'EFFECT') return typeof target.instanceId === 'string' && !!target.instanceId;
  return false;
}

export function isMatchSelection(value: unknown): value is MatchSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as { ruleset?: unknown; profileId?: unknown };
  return (
    (selection.ruleset === 'CLASSIC' && selection.profileId === undefined) ||
    (selection.ruleset === 'POWERUPS_V1' && isVariantProfileId(selection.profileId))
  );
}
