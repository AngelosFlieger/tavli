import type { GameState, Move, Player } from '../game/engine';
import { gameStateInvariantViolations } from '../game/session/invariants';
import { isPhase } from '../game/session/phase';
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

export const PROTOCOL_MIN_VERSION = 3;
export const PROTOCOL_VERSION = 3;

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

export type CommandRequest = {
  commandId: string;
  command: Command;
};

export type PresentationJob =
  | { type: 'OPENING'; blocking: true; attempts: [number, number][] }
  | {
      type: 'DICE';
      blocking: true;
      values: [number, number];
      rerolledDie?: 0 | 1;
    }
  | { type: 'MOVE'; blocking: true; sequence: Move[] }
  | { type: 'RESET_DICE'; blocking: false };

export type RevisionedCommand = CommandRequest & {
  type: 'command';
  matchId: string;
  expectedRevision: number;
};

export type ClientPacket =
  | { type: 'hello'; protocol: number }
  | { type: 'find'; selection: MatchSelection }
  | { type: 'createRoom'; selection: MatchSelection }
  | { type: 'joinRoom'; code: string }
  | { type: 'cancel' }
  | RevisionedCommand
  | Command;

export type Update = {
  state: GameState;
  canUndo: boolean;
  events?: SessionEvent[];
  presentations: PresentationJob[];
};

export type AuthorityCursor = {
  matchId: string;
  revision: number;
};

export type CommandResult = {
  commandId: string;
  status: 'ACCEPTED' | 'REJECTED';
  reason?: 'STALE_REVISION' | 'INVALID_COMMAND';
};

export type RevisionedUpdate = Update &
  AuthorityCursor & {
    commandResult?: CommandResult;
  };

export function isAuthorityCursor(value: unknown): value is AuthorityCursor {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as { matchId?: unknown; revision?: unknown };
  return (
    typeof cursor.matchId === 'string' &&
    cursor.matchId.length > 0 &&
    Number.isSafeInteger(cursor.revision) &&
    Number(cursor.revision) >= 0
  );
}

export function isRevisionedCommand(value: unknown): value is RevisionedCommand {
  if (!value || typeof value !== 'object') return false;
  const packet = value as Partial<RevisionedCommand>;
  return (
    packet.type === 'command' &&
    typeof packet.commandId === 'string' &&
    packet.commandId.length > 0 &&
    typeof packet.matchId === 'string' &&
    packet.matchId.length > 0 &&
    Number.isSafeInteger(packet.expectedRevision) &&
    Number(packet.expectedRevision) >= 0 &&
    isCommand(packet.command)
  );
}

export function isPresentationJob(value: unknown): value is PresentationJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<PresentationJob>;
  if (job.type === 'OPENING')
    return (
      job.blocking === true &&
      Array.isArray(job.attempts) &&
      job.attempts.length > 0 &&
      isResolvedOpeningAttempts(job.attempts)
    );
  if (job.type === 'RESET_DICE') return job.blocking === false;
  if (job.type === 'DICE')
    return (
      job.blocking === true &&
      Array.isArray(job.values) &&
      job.values.length === 2 &&
      job.values.every(isDie) &&
      (job.rerolledDie === undefined || job.rerolledDie === 0 || job.rerolledDie === 1)
    );
  return (
    job.type === 'MOVE' &&
    job.blocking === true &&
    Array.isArray(job.sequence) &&
    job.sequence.length > 0 &&
    isCommand({ type: 'move', sequence: job.sequence })
  );
}

export function isRevisionedUpdate(value: unknown): value is RevisionedUpdate {
  if (!value || typeof value !== 'object' || !isAuthorityCursor(value)) return false;
  const update = value as Partial<RevisionedUpdate>;
  if (!(
    isNetworkGameState(update.state) &&
    typeof update.canUndo === 'boolean' &&
    Array.isArray(update.presentations) &&
    update.presentations.length <= 1 &&
    update.presentations.every(isPresentationJob) &&
    (update.commandResult === undefined || isCommandResult(update.commandResult)) &&
    (update.events === undefined || isSessionEvents(update.events))
  ))
    return false;
  const opening = update.presentations.find((job) => job.type === 'OPENING');
  return (
    !opening ||
    (update.state.opening.status === 'RESOLVED' &&
      sameOpeningAttempts(opening.attempts, update.state.opening.attempts))
  );
}

function isCommandResult(value: unknown): value is CommandResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.commandId === 'string' &&
    result.commandId.length > 0 &&
    (result.status === 'ACCEPTED' || result.status === 'REJECTED') &&
    (result.reason === undefined ||
      result.reason === 'STALE_REVISION' ||
      result.reason === 'INVALID_COMMAND') &&
    (result.status === 'REJECTED' || result.reason === undefined)
  );
}

function isSessionEvents(value: unknown): value is SessionEvent[] {
  return Array.isArray(value) && value.every(isSessionEvent);
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case 'GameReset':
    case 'NoLegalMoves':
    case 'MovesAvailable':
    case 'MovesComplete':
    case 'MoveUndone':
    case 'DraftCompleted':
      return true;
    case 'RollStarted':
      return isPlayer(event.player);
    case 'OpeningResolved':
      return isResolvedOpeningAttempts(event.attempts) && isPlayer(event.player);
    case 'DiceRolled':
      return isPlayer(event.player) && Array.isArray(event.values) && event.values.every(isDie);
    case 'CheckerMoved':
      return ['checker', 'from', 'to', 'die'].every((key) => isNonNegativeInteger(event[key]));
    case 'CheckerPinned':
      return ['checker', 'victim', 'point'].every((key) => isNonNegativeInteger(event[key]));
    case 'CheckerBorneOff':
      return isNonNegativeInteger(event.checker) && isPlayer(event.player);
    case 'GameEnded':
      return isOutcome(event.outcome);
    case 'TurnEnded':
      return isPlayer(event.player) && isPlayer(event.next);
    case 'RoundCompleted':
    case 'DraftDue':
      return isNonNegativeInteger(event.round);
    case 'DraftOpened':
      return Array.isArray(event.offer) && event.offer.every(isAbilityId);
    case 'DraftOrderRolled':
    case 'DraftOrderTied':
      return Array.isArray(event.rolls) && event.rolls.length === 2 && event.rolls.every(isDie);
    case 'DraftOrderChosen':
      return isPlayer(event.first);
    case 'AbilityPicked':
    case 'AbilityReplaced':
      return isPlayer(event.player) && isAbilityId(event.abilityId);
    case 'AbilityUsed':
      return (
        isPlayer(event.player) &&
        isAbilityId(event.abilityId) &&
        (event.target === undefined || isAbilityTarget(event.target))
      );
    case 'DiceModified':
      return (
        ['recast', 'nudge', 'opportunist', 'jinx'].includes(String(event.abilityId)) &&
        (event.dieIndex === 0 || event.dieIndex === 1) &&
        isDie(event.before) &&
        isDie(event.after)
      );
    case 'EffectExpired':
      return isAbilityId(event.abilityId);
    case 'EffectsRemoved':
      return (
        event.abilityId === 'clearSkies' &&
        Array.isArray(event.removed) &&
        event.removed.every(
          (removed) =>
            !!removed &&
            typeof removed === 'object' &&
            typeof (removed as Record<string, unknown>).instanceId === 'string' &&
            isAbilityId((removed as Record<string, unknown>).abilityId),
        )
      );
    case 'FocusGained':
      return isPlayer(event.player) && isNonNegativeInteger(event.focus);
    default:
      return false;
  }
}

function isAbilityId(value: unknown): value is AbilityId {
  return typeof value === 'string' && ABILITY_IDS.includes(value as AbilityId);
}

function isResolvedOpeningAttempts(value: unknown): value is [number, number][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (
    !value.every(
      (attempt) => Array.isArray(attempt) && attempt.length === 2 && attempt.every(isDie),
    )
  )
    return false;
  return (
    value.slice(0, -1).every(([first, second]) => first === second) &&
    value.at(-1)![0] !== value.at(-1)![1]
  );
}

function sameOpeningAttempts(left: [number, number][], right: [number, number][]) {
  return (
    left.length === right.length &&
    left.every(
      (attempt, index) => attempt[0] === right[index]?.[0] && attempt[1] === right[index]?.[1],
    )
  );
}

const OUTCOME_KINDS = [
  'BEAR_OFF',
  'MARS',
  'MOTHER_VICTORY',
  'DRAW',
  'RESIGNATION',
  'DISCONNECT',
  'NO_SHOW',
  'ABANDONED',
  'TIMEOUT',
] as const;

/** Structural and semantic guard for authoritative state crossing the wire. */
export function isNetworkGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GameState> & Record<string, unknown>;
  if (
    !Array.isArray(state.board) ||
    state.board.length !== 24 ||
    !Array.isArray(state.off) ||
    state.off.length !== 2
  )
    return false;
  const stacks = [...state.board, ...state.off];
  if (
    !stacks.every(
      (stack) =>
        Array.isArray(stack) &&
        stack.every((checker) => Number.isInteger(checker) && checker >= 0 && checker < 30),
    )
  )
    return false;
  if (!isPhase(state.phase) || (state.active !== null && state.active !== 0 && state.active !== 1))
    return false;
  if (!isDice(state.remaining) || !isDice(state.roll)) return false;
  if (!isOpeningState(state.opening)) return false;
  if (state.outcome !== null && !isOutcome(state.outcome)) return false;
  if (state.ruleset !== 'CLASSIC' && state.ruleset !== 'POWERUPS_V1') return false;
  if (state.variantConfigHash !== null && typeof state.variantConfigHash !== 'string') return false;
  if (!isPowerupsState(state.powerups, state.ruleset)) return false;
  if (!Array.isArray(state.diceModifiers) || !state.diceModifiers.every(isDiceModifier))
    return false;
  if (state.rollSource !== null && state.rollSource !== 'loadedKnuckles') return false;
  if (state.clock !== null && !isClock(state.clock)) return false;
  return gameStateInvariantViolations(state as GameState).length === 0;
}

function isPowerupsState(value: unknown, ruleset: GameState['ruleset']): boolean {
  if (ruleset === 'CLASSIC') return value === null;
  if (!value || typeof value !== 'object') return false;
  const powerups = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(powerups.completedRounds) &&
    isTuple(powerups.actedThisRound, (entry) => typeof entry === 'boolean') &&
    isTuple(powerups.loadouts, isPlayerLoadout) &&
    Array.isArray(powerups.activeEffects) &&
    powerups.activeEffects.every(isActiveEffect) &&
    isTuple(powerups.passiveCounters, isNumberRecord) &&
    isTuple(powerups.passivePolicies, isPassivePolicy) &&
    isNonNegativeInteger(powerups.powerupsUsedThisTurn) &&
    typeof powerups.checkerMovedThisTurn === 'boolean' &&
    isNonNegativeInteger(powerups.nextAbilityInstance) &&
    (powerups.draft === null || isDraftState(powerups.draft))
  );
}

function isTuple(value: unknown, item: (value: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(item);
}

function isPlayerLoadout(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const loadout = value as Record<string, unknown>;
  return (
    Array.isArray(loadout.powerups) &&
    loadout.powerups.every(isAbilityInstance) &&
    Array.isArray(loadout.passives) &&
    loadout.passives.every(isAbilityInstance)
  );
}

function isAbilityInstance(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const instance = value as Record<string, unknown>;
  return (
    typeof instance.instanceId === 'string' &&
    instance.instanceId.length > 0 &&
    typeof instance.abilityId === 'string' &&
    ABILITY_IDS.includes(instance.abilityId as AbilityId)
  );
}

function isActiveEffect(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const effect = value as Record<string, unknown>;
  const duration = effect.duration as Record<string, unknown> | null;
  return (
    isAbilityInstance(effect) &&
    isPlayer(effect.source) &&
    isPlayer(effect.affectedPlayer) &&
    isAbilityTarget(effect.target) &&
    Array.isArray(effect.tags) &&
    effect.tags.every((tag) => ['CONTROL', 'DICE_PENALTY', 'PROTECTION'].includes(String(tag))) &&
    Array.isArray(effect.constraints) &&
    effect.constraints.every(isEffectConstraint) &&
    !!duration &&
    ['SOURCE_TURN_END', 'TARGET_TURN_END', 'NEXT_DRAFT'].includes(String(duration.boundary)) &&
    isNonNegativeInteger(duration.count) &&
    isNonNegativeInteger(effect.remaining)
  );
}

function isEffectConstraint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const constraint = value as Record<string, unknown>;
  if (constraint.kind === 'BLOCK_LEAVING' || constraint.kind === 'BLOCK_LANDING') return true;
  if (constraint.kind === 'ANCHOR_CHECKER')
    return (
      Number.isInteger(constraint.checker) &&
      Number(constraint.checker) >= 0 &&
      Number(constraint.checker) < 30
    );
  return (
    constraint.kind === 'DICE_PENALTY' &&
    Number.isInteger(constraint.penalty) &&
    Number.isInteger(constraint.minimumToken) &&
    (constraint.targetToken === 'HIGHEST' || constraint.targetToken === 'LOWEST') &&
    typeof constraint.affectDoubles === 'boolean' &&
    typeof constraint.unaffectedDoubleConsumes === 'boolean' &&
    (constraint.doubleHandling === 'CHANGE_ONE_TOKEN' ||
      constraint.doubleHandling === 'CHANGE_MATCHING_TOKENS')
  );
}

function isDraftState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  if (!isPlayer(draft.resumePlayer)) return false;
  if (draft.stage === 'AWAITING_OFFER') return true;
  if (
    (draft.stage !== 'ORDER_ROLL' && draft.stage !== 'PICKING') ||
    !Array.isArray(draft.offer) ||
    !draft.offer.every((id) => typeof id === 'string' && ABILITY_IDS.includes(id as AbilityId)) ||
    !Array.isArray(draft.attempts) ||
    !draft.attempts.every(isPositivePair)
  )
    return false;
  if (draft.stage === 'ORDER_ROLL') return true;
  return (
    Array.isArray(draft.pickOrder) &&
    draft.pickOrder.every(isPlayer) &&
    isNonNegativeInteger(draft.currentPick) &&
    Number(draft.currentPick) <= draft.pickOrder.length &&
    Array.isArray(draft.picks) &&
    draft.picks.every(
      (pick) =>
        !!pick &&
        typeof pick === 'object' &&
        isPlayer((pick as Record<string, unknown>).player) &&
        ABILITY_IDS.includes((pick as Record<string, unknown>).abilityId as AbilityId),
    )
  );
}

function isPositivePair(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => Number.isInteger(entry) && entry > 0)
  );
}

function isNumberRecord(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(isNonNegativeInteger)
  );
}

function isPassivePolicy(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (policy.homeGuard === undefined) return true;
  if (!policy.homeGuard || typeof policy.homeGuard !== 'object') return false;
  const guard = policy.homeGuard as Record<string, unknown>;
  return (
    typeof guard.protectOwnHome === 'boolean' &&
    typeof guard.restrictOpponentHome === 'boolean' &&
    typeof guard.excludeStartPoints === 'boolean'
  );
}

function isDiceModifier(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const modifier = value as Record<string, unknown>;
  return (
    typeof modifier.instanceId === 'string' &&
    ['recast', 'nudge', 'opportunist', 'jinx'].includes(String(modifier.abilityId)) &&
    isPlayer(modifier.source) &&
    (modifier.dieIndex === 0 || modifier.dieIndex === 1) &&
    isDie(modifier.before) &&
    isDie(modifier.after) &&
    Array.isArray(modifier.randomResults) &&
    modifier.randomResults.every(isDie) &&
    (modifier.option === undefined ||
      modifier.option === 'INCREASE' ||
      modifier.option === 'DECREASE') &&
    typeof modifier.allowBearingOff === 'boolean'
  );
}

function isAbilityTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  if (target.type === 'PLAYER') return isPlayer(target.player);
  if (target.type === 'POINT')
    return Number.isInteger(target.point) && Number(target.point) >= 0 && Number(target.point) < 24;
  if (target.type === 'CHECKER')
    return (
      Number.isInteger(target.checker) && Number(target.checker) >= 0 && Number(target.checker) < 30
    );
  if (target.type === 'DIE') return target.index === 0 || target.index === 1;
  return (
    target.type === 'EFFECT' &&
    typeof target.instanceId === 'string' &&
    target.instanceId.length > 0
  );
}

function isPlayer(value: unknown): value is Player {
  return value === 0 || value === 1;
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isOpeningState(value: unknown): value is GameState['opening'] {
  if (!value || typeof value !== 'object') return false;
  const opening = value as Record<string, unknown>;
  if (opening.status === 'PENDING') return true;
  return (
    opening.status === 'RESOLVED' &&
    (opening.winner === 0 || opening.winner === 1) &&
    isResolvedOpeningAttempts(opening.attempts)
  );
}

function isClock(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const clock = value as Record<string, unknown>;
  return (
    Number.isFinite(clock.remainingMs) &&
    Number(clock.remainingMs) >= 0 &&
    typeof clock.running === 'boolean' &&
    (clock.deadline === null || Number.isFinite(clock.deadline))
  );
}

function isOutcome(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const outcome = value as Record<string, unknown>;
  return (
    (outcome.winner === null || outcome.winner === 0 || outcome.winner === 1) &&
    Number.isInteger(outcome.points) &&
    Number(outcome.points) >= 0 &&
    typeof outcome.reason === 'string' &&
    typeof outcome.kind === 'string' &&
    OUTCOME_KINDS.includes(outcome.kind as (typeof OUTCOME_KINDS)[number])
  );
}

function isDice(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isDie);
}

export type ServerMessage =
  | { type: 'ready'; protocol: number; name: string }
  | { type: 'rejected'; reason?: 'AUTH' | 'PROTOCOL' }
  | { type: 'error'; code: ClientErrorCode }
  | { type: 'waiting' }
  | { type: 'room'; code: string }
  | ({
      type: 'matched';
      you: Player;
      players: [string, string];
      state: GameState;
      variantConfig: ResolvedVariantConfig | null;
      presentations?: PresentationJob[];
      events?: SessionEvent[];
    } & AuthorityCursor)
  | ({
      type: 'resume';
      you: Player;
      players: [string, string];
      state: GameState;
      canUndo: boolean;
      variantConfig: ResolvedVariantConfig | null;
      presentations?: PresentationJob[];
      events?: SessionEvent[];
    } & AuthorityCursor)
  | ({ type: 'update' } & RevisionedUpdate)
  | { type: 'rematch'; status: 'OFFERED' | 'DECLINED' }
  | { type: 'left' };

export function isHello(value: unknown): value is { type: 'hello'; protocol: number } {
  if (!value || typeof value !== 'object') return false;
  const message = value as { type?: unknown; protocol?: unknown };
  return message.type === 'hello' && Number.isInteger(message.protocol);
}

export function isProtocolCompatible(value: number): boolean {
  return Number.isInteger(value) && value >= PROTOCOL_MIN_VERSION && value <= PROTOCOL_VERSION;
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

function isDie(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6;
}

export function isMatchSelection(value: unknown): value is MatchSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as { ruleset?: unknown; profileId?: unknown };
  return (
    (selection.ruleset === 'CLASSIC' && selection.profileId === undefined) ||
    (selection.ruleset === 'POWERUPS_V1' && isVariantProfileId(selection.profileId))
  );
}
