import { legalMoves } from '../game/rules/moves';
import type { Move, Player, Position } from '../game/rules/position';
import { initialPresentedSession, sessionMessage } from '../game/session/messages';
import type { GameState, Session } from '../game/session/state';
import {
  transitionSession,
  type SessionCommand,
  type SessionEvent,
  type SessionResult,
} from '../game/session/transition';
import type { RandomInt } from '../game/random';
import type { Command } from '../net/messages';
import { advancePendingDraft, secureRandomInt } from '../game/variant/authority';
import {
  CLASSIC_RULES,
  type AbilityActivation,
  type AbilityId,
  type AbilityInstance,
  type AbilityTarget,
  type ResolvedVariantConfig,
  type RollAbilityOption,
  type RulesContext,
} from '../game/variant/types';
import { endTurnAbilityTargets } from '../game/variant/activation';
import { beforeRollAbilityTargets } from '../game/variant/powerups/before-roll';
import { abilityRegistry } from '../game/variant/abilities/registry';
import { rollAbilityOptions, rollAbilityRandomCount } from '../game/variant/roll-activation';
import { generateMovementRoll, inventoryCapacity } from '../game/variant/passives/policy';
import { PickupSelection } from './pickup-selection';

type RemoteState = { epoch: number; state: GameState; canUndo: boolean };

type ControllerOperation =
  | { type: 'IDLE' }
  | { type: 'ROLL'; authority: 'LOCAL'; forced: [number, number] | null }
  | { type: 'ROLL'; authority: 'ONLINE' }
  | { type: 'MOVE'; authority: 'LOCAL' | 'ONLINE' }
  | { type: 'DRAFT_PICK' }
  | { type: 'END_TURN' }
  | { type: 'FORFEIT' }
  | { type: 'ABILITY'; completion: 'ONLINE_UPDATE' | 'LOCAL_DICE_PRESENTATION' }
  | { type: 'REMOTE_MOVE'; result: RemoteState };

type ActiveControllerOperation = Exclude<ControllerOperation, { type: 'IDLE' }>;

export type LocalMoveRequest = {
  type: 'local';
  start: Position;
  stages: Position[];
  checker: number;
  player: Player;
};
export type MoveRequest = LocalMoveRequest | { type: 'sent' };
export type RollAbilityRequest =
  | { type: 'local'; dice?: [number, number]; rerolledDie?: 0 | 1 }
  | { type: 'sent' };

/** Routes user commands to local rules or the online authority, independent of rendering. */
export class GameController {
  readonly pickup = new PickupSelection();
  private session: Session;
  private moveKey = '';
  private cachedMoves: Move[] = [];
  private online: { you: Player; send: (command: Command) => void } | null = null;
  private remoteCanUndo = false;
  private operation: ControllerOperation = { type: 'IDLE' };
  private epoch = 0;
  private pendingRoll: RemoteState | null = null;
  private abilitySelection: {
    instanceId: string;
    target?: AbilityActivation['target'];
    option?: AbilityActivation['option'];
  } | null = null;
  private eventSink: ((events: SessionEvent[], state: GameState) => void) | null = null;

  constructor(
    private rules: RulesContext = CLASSIC_RULES,
    private randomInt: RandomInt = secureRandomInt,
  ) {
    this.session = initialPresentedSession(rules);
  }

  get state(): GameState {
    return this.session.state;
  }

  get seat(): Player | null {
    return this.online?.you ?? null;
  }

  get scripted(): boolean {
    return this.online !== null;
  }

  get variantConfig(): ResolvedVariantConfig | null {
    return this.rules.variantConfig;
  }

  get canUndo(): boolean {
    return this.online ? this.remoteCanUndo : this.session.history.length > 0;
  }

  get busy(): boolean {
    return this.operation.type !== 'IDLE';
  }

  get throwingPlayer(): Player {
    return this.state.active ?? 0;
  }

  get selectedAbility(): AbilityInstance | null {
    const active = this.state.active;
    if (active === null || !this.abilitySelection || !this.state.powerups) return null;
    const loadout = this.state.powerups.loadouts[active];
    return (
      [...loadout.powerups, ...loadout.passives].find(
        (instance) => instance.instanceId === this.abilitySelection!.instanceId,
      ) ?? null
    );
  }

  get selectedAbilityTarget(): AbilityActivation['target'] | null {
    return this.abilitySelection?.target ?? null;
  }

  mine(): boolean {
    const draft = this.state.powerups?.draft;
    if (draft?.stage === 'PICKING') {
      const picker = draft.pickOrder[draft.currentPick];
      return !this.online || this.online.you === picker;
    }
    return !this.online || this.online.you === this.state.active;
  }

  configure(rules: RulesContext, randomInt: RandomInt = secureRandomInt): boolean {
    if (this.busy || this.online) return false;
    this.rules = rules;
    this.randomInt = randomInt;
    this.adopt(initialPresentedSession(rules).state, false);
    return true;
  }

  setEventSink(sink: ((events: SessionEvent[], state: GameState) => void) | null): void {
    this.eventSink = sink;
  }

  recordAuthoritativeEvents(events: SessionEvent[] | undefined, state: GameState): void {
    if (events?.length) this.eventSink?.(events, state);
  }

  moves(): Move[] {
    if (this.state.active === null || this.state.phase !== 'WAITING_FOR_MOVE') return [];
    const key = JSON.stringify([
      this.state.board,
      this.state.remaining,
      this.state.active,
      this.state.powerups?.activeEffects,
    ]);
    if (key !== this.moveKey) {
      this.moveKey = key;
      this.cachedMoves = legalMoves(this.state, this.state.active, this.state.remaining);
    }
    return this.cachedMoves;
  }

  private dispatchLocal(command: SessionCommand): SessionResult {
    const result = transitionSession(this.session, command, this.rules);
    if (!result.ok) return result;
    this.session = result.session;
    const message = sessionMessage(this.state, result.events);
    if (message !== null) this.state.message = message;
    this.eventSink?.(result.events, this.state);
    return result;
  }

  private sendOnline(command: Command, operation: ActiveControllerOperation): void {
    if (!this.online) throw new Error('online command requested without an authority connection');
    this.operation = operation;
    this.online.send(command);
  }

  pickAt(point: number): number | null {
    if (this.busy || this.abilitySelection || !this.mine()) return null;
    return this.pickup.pickAt(point, this.state);
  }

  releaseLastPickup(): number | undefined {
    return this.pickup.releaseLast();
  }

  clearPickup(): void {
    this.pickup.clear();
  }

  join(you: Player, send: (command: Command) => void, rules: RulesContext = this.rules): void {
    this.rules = rules;
    this.online = { you, send };
    this.remoteCanUndo = false;
  }

  leaveOnline(): void {
    this.online = null;
    this.adopt(initialPresentedSession(this.rules).state, false);
  }

  beginRoll(locked = false): boolean {
    if (locked || this.busy || this.abilitySelection || !this.mine()) return false;
    if (this.online) {
      if (!['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(this.state.phase)) return false;
      this.sendOnline({ type: 'roll' }, { type: 'ROLL', authority: 'ONLINE' });
      return true;
    }
    const accepted = this.dispatchLocal({ type: 'beginRoll' }).ok;
    if (accepted) {
      const config = this.rules.variantConfig;
      const active = this.state.active;
      const forced: [number, number] | null =
        active === null
          ? null
          : config
            ? generateMovementRoll(
                this.state,
                active,
                config,
                () => this.randomInt(6) + 1,
                this.randomInt,
              )
            : [this.randomInt(6) + 1, this.randomInt(6) + 1];
      this.operation = { type: 'ROLL', authority: 'LOCAL', forced };
    }
    return accepted;
  }

  takeForcedLocalRoll(): [number, number] | null {
    if (this.operation.type !== 'ROLL' || this.operation.authority !== 'LOCAL') return null;
    const values = this.operation.forced;
    this.operation = { ...this.operation, forced: null };
    return values;
  }

  receiveRoll(values: number[]): void {
    if (
      this.operation.type === 'ABILITY' &&
      this.operation.completion === 'LOCAL_DICE_PRESENTATION'
    ) {
      this.operation = { type: 'IDLE' };
      this.pickup.clear();
      return;
    }
    if (this.operation.type !== 'ROLL') return;
    if (this.operation.authority === 'LOCAL') this.dispatchLocal({ type: 'receiveRoll', values });
    this.operation = { type: 'IDLE' };
    this.pickup.clear();
  }

  requestMove(sequence: Move[], locked = false): MoveRequest | null {
    if (
      locked ||
      this.busy ||
      this.abilitySelection ||
      !this.mine() ||
      this.state.phase !== 'WAITING_FOR_MOVE'
    )
      return null;
    if (this.online) {
      this.sendOnline({ type: 'move', sequence }, { type: 'MOVE', authority: 'ONLINE' });
      return { type: 'sent' };
    }
    const from = sequence[0]?.from;
    const checker = from === undefined ? undefined : this.state.board[from]?.at(-1);
    if (checker === undefined || this.state.active === null) return null;
    const start: Position = { board: this.state.board, off: this.state.off };
    const player = this.state.active;
    const result = this.dispatchLocal({ type: 'move', sequence });
    if (!result.ok) return null;
    this.operation = { type: 'MOVE', authority: 'LOCAL' };
    this.pickup.consume(checker);
    return { type: 'local', start, stages: result.stages!, checker, player };
  }

  finishLocalMove(): void {
    if (this.operation.type !== 'MOVE' || this.operation.authority !== 'LOCAL') return;
    this.operation = { type: 'IDLE' };
    this.pickup.revalidate(this.state);
  }

  get hasLocalMove(): boolean {
    return this.operation.type === 'MOVE' && this.operation.authority === 'LOCAL';
  }

  undo(locked = false): boolean {
    if (locked || this.busy || this.abilitySelection || !this.mine()) return false;
    if (this.online) {
      this.online.send({ type: 'undo' });
      return true;
    }
    const undone = this.dispatchLocal({ type: 'undo' }).ok;
    if (undone) this.pickup.clear();
    return undone;
  }

  endTurn(locked = false): boolean {
    if (locked || this.busy || !this.mine() || this.state.phase !== 'TURN_COMPLETE') return false;
    if (this.abilitySelection && !this.abilitySelection.target) return false;
    const ability = this.abilitySelection?.target
      ? { instanceId: this.abilitySelection.instanceId, target: this.abilitySelection.target }
      : undefined;
    if (this.online) {
      this.sendOnline({ type: 'end', ...(ability ? { ability } : {}) }, { type: 'END_TURN' });
      this.abilitySelection = null;
      return true;
    }
    const ended = this.dispatchLocal({ type: 'endTurn', ...(ability ? { ability } : {}) }).ok;
    if (ended) {
      this.abilitySelection = null;
      this.pickup.clear();
      const advanced = advancePendingDraft(this.session, this.rules, this.randomInt);
      this.session = advanced.session;
      this.eventSink?.(advanced.events, this.state);
    }
    return ended;
  }

  abilityTargetPoints(instanceId = this.abilitySelection?.instanceId): number[] {
    return this.abilityTargets(instanceId).flatMap((target) =>
      target.type === 'POINT' ? [target.point] : [],
    );
  }

  abilityTargets(instanceId = this.abilitySelection?.instanceId): AbilityTarget[] {
    const config = this.rules.variantConfig;
    const active = this.state.active;
    if (!instanceId || !config || active === null || !this.mine()) return [];
    return [
      ...beforeRollAbilityTargets(this.state, active, instanceId, config),
      ...endTurnAbilityTargets(this.state, active, instanceId, config),
    ];
  }

  rollAbilityOptions(instanceId = this.abilitySelection?.instanceId): RollAbilityOption[] {
    const config = this.rules.variantConfig;
    const active = this.state.active;
    if (!instanceId || !config || active === null || !this.mine() || this.pickup.items.length)
      return [];
    return rollAbilityOptions(this.state, active, instanceId, config);
  }

  abilityIsPlayable(instanceId: string): boolean {
    return (
      this.abilityTargets(instanceId).length > 0 || this.rollAbilityOptions(instanceId).length > 0
    );
  }

  selectAbility(instanceId: string): boolean {
    if (this.busy || !this.mine() || !this.abilityIsPlayable(instanceId)) return false;
    const targets = this.abilityTargets(instanceId);
    const onlyTarget =
      this.state.phase === 'TURN_COMPLETE' && targets.length === 1 && targets[0].type !== 'POINT'
        ? targets[0]
        : undefined;
    this.abilitySelection = { instanceId, ...(onlyTarget ? { target: onlyTarget } : {}) };
    return true;
  }

  selectEndTurnAbility(instanceId: string): boolean {
    return this.state.phase === 'TURN_COMPLETE' && this.selectAbility(instanceId);
  }

  targetSelectedAbility(point: number): boolean {
    if (!this.abilitySelection || !this.abilityTargetPoints().includes(point)) return false;
    this.abilitySelection.target = { type: 'POINT', point };
    return true;
  }

  cancelSelectedAbility(): void {
    this.abilitySelection = null;
  }

  requestBeforeRollAbility(target: AbilityTarget): RollAbilityRequest | null {
    const config = this.rules.variantConfig;
    const active = this.state.active;
    if (
      this.busy ||
      !config ||
      active === null ||
      !this.mine() ||
      !this.abilitySelection ||
      target.type !== 'EFFECT' ||
      !this.abilityTargets().some(
        (candidate) => candidate.type === 'EFFECT' && candidate.instanceId === target.instanceId,
      )
    )
      return null;
    const activation: AbilityActivation = {
      instanceId: this.abilitySelection.instanceId,
      target,
    };
    if (this.online) {
      this.sendOnline(
        { type: 'playAbility', activation },
        { type: 'ABILITY', completion: 'ONLINE_UPDATE' },
      );
      this.abilitySelection = null;
      return { type: 'sent' };
    }
    const used = this.dispatchLocal({
      type: 'useBeforeRollAbility',
      player: active,
      activation,
    }).ok;
    if (!used) return null;
    this.abilitySelection = null;
    this.pickup.clear();
    return { type: 'local' };
  }

  requestRollAbility(option: RollAbilityOption): RollAbilityRequest | null {
    const config = this.rules.variantConfig;
    const active = this.state.active;
    if (
      this.busy ||
      !config ||
      active === null ||
      !this.mine() ||
      !this.abilitySelection ||
      !this.rollAbilityOptions().some(
        (candidate) =>
          candidate.target.index === option.target.index && candidate.option === option.option,
      )
    )
      return null;
    const activation: AbilityActivation = {
      instanceId: this.abilitySelection.instanceId,
      target: option.target,
      ...(option.option ? { option: option.option } : {}),
    };
    if (this.online) {
      this.sendOnline(
        { type: 'playAbility', activation },
        { type: 'ABILITY', completion: 'ONLINE_UPDATE' },
      );
      this.abilitySelection = null;
      return { type: 'sent' };
    }
    const randomCount = rollAbilityRandomCount(this.state, active, activation, config);
    if (randomCount === null) return null;
    const randomValues = Array.from({ length: randomCount }, () => this.randomInt(6) + 1);
    const used = this.dispatchLocal({
      type: 'useRollAbility',
      player: active,
      activation,
      randomValues,
    }).ok;
    if (!used) return null;
    this.abilitySelection = null;
    this.pickup.clear();
    if (randomCount) this.operation = { type: 'ABILITY', completion: 'LOCAL_DICE_PRESENTATION' };
    return {
      type: 'local',
      ...(randomCount
        ? {
            dice: this.state.roll as [number, number],
            rerolledDie: option.target.index,
          }
        : {}),
    };
  }

  pickAbility(abilityId: AbilityId, replaceInstanceId?: string): boolean {
    if (this.busy || this.state.phase !== 'DRAFT_PICK') return false;
    const draft = this.state.powerups?.draft;
    if (draft?.stage !== 'PICKING') return false;
    const player = draft.pickOrder[draft.currentPick];
    if (this.online) {
      if (this.online.you !== player) return false;
      this.sendOnline(
        {
          type: 'pickAbility',
          abilityId,
          ...(replaceInstanceId === undefined ? {} : { replaceInstanceId }),
        },
        { type: 'DRAFT_PICK' },
      );
      return true;
    }
    return this.dispatchLocal({ type: 'pickAbility', player, abilityId, replaceInstanceId }).ok;
  }

  inventoryCapacity(player: Player, abilityId: AbilityId): number {
    const config = this.rules.variantConfig;
    const powerups = this.state.powerups;
    if (!config || !powerups) return 0;
    const kind = abilityRegistry[abilityId].kind;
    return inventoryCapacity(powerups, player, kind, config);
  }

  canRestart(locked = false): boolean {
    if (locked || this.busy) return false;
    return !this.online || this.state.phase === 'GAME_OVER';
  }

  forfeit(locked = false): boolean {
    if (locked || this.busy || !this.online || this.state.phase === 'GAME_OVER') return false;
    this.sendOnline({ type: 'forfeit' }, { type: 'FORFEIT' });
    return true;
  }

  restart(locked = false): 'local' | 'sent' | null {
    if (!this.canRestart(locked)) return null;
    if (this.online) {
      this.online.send({ type: 'restart' });
      return 'sent';
    }
    this.dispatchLocal({ type: 'restart' });
    this.pickup.clear();
    return 'local';
  }

  queueRoll(state: GameState, canUndo: boolean): void {
    this.pendingRoll = { epoch: this.epoch, state, canUndo };
  }

  presentedRoll(): { state: GameState; canUndo: boolean } | null {
    const result = this.pendingRoll;
    this.pendingRoll = null;
    return result && result.epoch === this.epoch ? result : null;
  }

  beginRemoteMove(sequence: Move[], state: GameState, canUndo: boolean): number | null {
    const checker = this.state.board[sequence[0]?.from]?.at(-1);
    if (checker === undefined) {
      this.operation = { type: 'IDLE' };
      return null;
    }
    this.pickup.consume(checker);
    this.operation = {
      type: 'REMOTE_MOVE',
      result: { epoch: this.epoch, state, canUndo },
    };
    return checker;
  }

  finishRemoteMove(): { state: GameState; canUndo: boolean } | null {
    if (this.operation.type !== 'REMOTE_MOVE') return null;
    const result = this.operation.result;
    this.operation = { type: 'IDLE' };
    return result && result.epoch === this.epoch ? result : null;
  }

  get hasRemoteMove(): boolean {
    return this.operation.type === 'REMOTE_MOVE' && this.operation.result.epoch === this.epoch;
  }

  adopt(state: GameState, canUndo: boolean, preservePickup = false): void {
    this.epoch++;
    this.pendingRoll = null;
    this.operation = { type: 'IDLE' };
    this.remoteCanUndo = canUndo;
    this.abilitySelection = null;
    this.session = { state: structuredClone(state), history: [] };
    this.moveKey = '';
    if (preservePickup) this.pickup.revalidate(this.state);
    else this.pickup.clear();
  }
}
