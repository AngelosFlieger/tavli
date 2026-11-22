import type { Move, Player, Position } from '../game/rules/position';
import type { GameState } from '../game/session/state';
import type { SessionCommand, SessionEvent, SessionResult } from '../game/session/transition';
import type { RandomInt } from '../game/random';
import type { Command, CommandRequest } from '../net/messages';
import { secureRandomInt } from '../game/variant/authority';
import {
  CLASSIC_RULES,
  type AbilityActivation,
  type AbilityId,
  type AbilityTarget,
  type ResolvedVariantConfig,
  type RollAbilityOption,
  type RulesContext,
} from '../game/variant/types';
import { abilityRegistry } from '../game/variant/abilities/registry';
import { rollAbilityRandomCount } from '../game/variant/roll-activation';
import { inventoryCapacity } from '../game/variant/passives/policy';
import { OnlineAuthorityClient, type OnlineAuthorityPort } from './online-authority-client';
import { LocalAuthority, type LocalAuthorityPort } from './local-authority';
import { InteractionController, type ActiveInteractionOperation } from './interaction-controller';

export type LocalMoveRequest = {
  type: 'local';
  start: Position;
  stages: Position[];
  checker: number;
  player: Player;
};

export type MoveRequest = LocalMoveRequest | { type: 'sent' };

export type RollAbilityRequest =
  { type: 'local'; dice?: [number, number]; rerolledDie?: 0 | 1 } | { type: 'sent' };

/** Routes user commands to local rules or the online authority, independent of rendering. */
export class GameController {
  readonly interaction = new InteractionController();
  private localAuthority: LocalAuthorityPort;
  private remoteCanUndo = false;
  private eventSink: ((events: SessionEvent[], state: GameState) => void) | null = null;

  constructor(
    rules: RulesContext = CLASSIC_RULES,
    randomInt: RandomInt = secureRandomInt,
    private onlineAuthority: OnlineAuthorityPort = new OnlineAuthorityClient(),
    localAuthority?: LocalAuthorityPort,
  ) {
    this.localAuthority = localAuthority ?? new LocalAuthority(rules, randomInt);
  }

  get state(): GameState {
    return this.localAuthority.state;
  }

  get seat(): Player | null {
    return this.onlineAuthority.seat;
  }

  get scripted(): boolean {
    return this.onlineAuthority.connected;
  }

  get variantConfig(): ResolvedVariantConfig | null {
    return this.localAuthority.rules.variantConfig;
  }

  get canUndo(): boolean {
    return this.onlineAuthority.connected ? this.remoteCanUndo : this.localAuthority.canUndo;
  }

  get busy(): boolean {
    return this.interaction.busy;
  }

  get pickup() {
    return this.interaction.pickup;
  }

  get pendingOnlineCommandId(): string | null {
    return this.onlineAuthority.pendingCommandId;
  }

  get throwingPlayer(): Player {
    return this.state.active ?? 0;
  }

  get selectedAbility() {
    return this.interaction.selectedAbility(this.state);
  }

  get selectedAbilityTarget(): AbilityActivation['target'] | null {
    return this.interaction.selectedAbilityTarget;
  }

  mine(): boolean {
    const draft = this.state.powerups?.draft;

    if (draft?.stage === 'PICKING') {
      const picker = draft.pickOrder[draft.currentPick];

      return !this.onlineAuthority.connected || this.onlineAuthority.seat === picker;
    }

    return !this.onlineAuthority.connected || this.onlineAuthority.seat === this.state.active;
  }

  configure(rules: RulesContext, randomInt: RandomInt = secureRandomInt): boolean {
    if (this.busy || this.onlineAuthority.connected) return false;

    this.localAuthority.configure(rules, randomInt);
    this.adopt(this.localAuthority.state, false);

    return true;
  }

  resolveLocalOpening(): [number, number][] | null {
    if (this.onlineAuthority.connected) return null;

    const resolution = this.localAuthority.resolveOpening();

    if (!resolution) return null;

    this.interaction.adopt(this.state, false);
    this.eventSink?.(resolution.events, this.state);

    return resolution.attempts;
  }

  setEventSink(sink: ((events: SessionEvent[], state: GameState) => void) | null): void {
    this.eventSink = sink;
  }

  recordAuthoritativeEvents(events: SessionEvent[] | undefined, state: GameState): void {
    if (events?.length) this.eventSink?.(events, state);
  }

  moves(): Move[] {
    return this.interaction.moves(this.state);
  }

  private dispatchLocal(command: SessionCommand): SessionResult {
    const result = this.localAuthority.transition(command);

    if (!result.ok) return result;

    this.eventSink?.(result.events, this.state);

    return result;
  }

  private sendOnline(command: Command, operation: ActiveInteractionOperation): void {
    this.interaction.start(operation);
    this.onlineAuthority.send(command);
  }

  private sendUntrackedOnline(command: Command): void {
    this.onlineAuthority.sendUntracked(command);
  }

  pickAt(point: number): number | null {
    return this.interaction.pickAt(point, this.state, this.mine());
  }

  releaseLastPickup(): number | undefined {
    return this.pickup.releaseLast();
  }

  clearPickup(): void {
    this.pickup.clear();
  }

  join(
    you: Player,
    send: (request: CommandRequest) => void,
    rules: RulesContext = this.localAuthority.rules,
  ): void {
    this.localAuthority.reset(rules);
    this.onlineAuthority.join(you, send);
    this.remoteCanUndo = false;
  }

  leaveOnline(): void {
    this.onlineAuthority.leave();
    this.localAuthority.reset();
    this.adopt(this.localAuthority.state, false);
  }

  beginRoll(locked = false): boolean {
    if (locked || this.busy || this.interaction.hasAbilitySelection || !this.mine()) return false;
    if (this.state.phase !== 'WAITING_FOR_ROLL') return false;
    if (this.onlineAuthority.connected) {
      this.sendOnline({ type: 'roll' }, { type: 'ROLL', authority: 'ONLINE' });

      return true;
    }

    const accepted = this.dispatchLocal({ type: 'beginRoll' }).ok;

    if (accepted) {
      const forced = this.localAuthority.movementRoll();

      this.interaction.start({ type: 'ROLL', authority: 'LOCAL', forced });
    }

    return accepted;
  }

  takeForcedLocalRoll(): [number, number] | null {
    return this.interaction.takeForcedLocalRoll();
  }

  receiveRoll(values: number[]): void {
    if (
      this.interaction.operation.type === 'ABILITY' &&
      this.interaction.operation.completion === 'LOCAL_DICE_PRESENTATION'
    ) {
      this.interaction.finish();
      this.pickup.clear();

      return;
    }
    if (this.interaction.operation.type !== 'ROLL') return;
    if (this.interaction.operation.authority === 'LOCAL')
      this.dispatchLocal({ type: 'receiveRoll', values });

    this.interaction.finish();
    this.pickup.clear();
  }

  requestMove(sequence: Move[], locked = false): MoveRequest | null {
    if (
      locked ||
      this.busy ||
      this.interaction.hasAbilitySelection ||
      !this.mine() ||
      this.state.phase !== 'WAITING_FOR_MOVE'
    )
      return null;
    if (this.onlineAuthority.connected) {
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

    this.interaction.start({ type: 'MOVE', authority: 'LOCAL' });
    this.pickup.consume(checker);

    return { type: 'local', start, stages: result.stages!, checker, player };
  }

  finishLocalMove(): void {
    if (
      this.interaction.operation.type !== 'MOVE' ||
      this.interaction.operation.authority !== 'LOCAL'
    )
      return;

    this.interaction.finish();
    this.pickup.revalidate(this.state);
  }

  get hasLocalMove(): boolean {
    return (
      this.interaction.operation.type === 'MOVE' && this.interaction.operation.authority === 'LOCAL'
    );
  }

  undo(locked = false): boolean {
    if (locked || this.busy || this.interaction.hasAbilitySelection || !this.mine()) return false;
    if (this.onlineAuthority.connected) {
      this.sendOnline({ type: 'undo' }, { type: 'UNDO' });

      return true;
    }

    const undone = this.dispatchLocal({ type: 'undo' }).ok;

    if (undone) this.pickup.clear();

    return undone;
  }

  endTurn(locked = false): boolean {
    if (locked || this.busy || !this.mine() || this.state.phase !== 'TURN_COMPLETE') return false;
    if (this.interaction.hasAbilitySelection && !this.interaction.selectedAbilityTarget)
      return false;

    const ability = this.interaction.selectedActivation() ?? undefined;

    if (this.onlineAuthority.connected) {
      this.sendOnline({ type: 'end', ...(ability ? { ability } : {}) }, { type: 'END_TURN' });
      this.interaction.cancelAbility();

      return true;
    }

    const ended = this.dispatchLocal({ type: 'endTurn', ...(ability ? { ability } : {}) }).ok;

    if (ended) {
      this.interaction.cancelAbility();
      this.pickup.clear();

      const events = this.localAuthority.advanceDraft();

      this.eventSink?.(events, this.state);
    }

    return ended;
  }

  abilityTargetPoints(instanceId = this.interaction.selectedAbilityInstanceId): number[] {
    return this.interaction.abilityTargetPoints(
      this.state,
      this.localAuthority.rules,
      this.mine(),
      instanceId,
    );
  }

  abilityTargets(instanceId = this.interaction.selectedAbilityInstanceId): AbilityTarget[] {
    return this.interaction.abilityTargets(
      this.state,
      this.localAuthority.rules,
      this.mine(),
      instanceId,
    );
  }

  rollAbilityOptions(instanceId = this.interaction.selectedAbilityInstanceId): RollAbilityOption[] {
    return this.interaction.rollAbilityOptions(
      this.state,
      this.localAuthority.rules,
      this.mine(),
      instanceId,
    );
  }

  abilityIsPlayable(instanceId: string): boolean {
    return this.interaction.abilityIsPlayable(
      this.state,
      this.localAuthority.rules,
      this.mine(),
      instanceId,
    );
  }

  selectAbility(instanceId: string): boolean {
    return this.interaction.selectAbility(
      this.state,
      this.localAuthority.rules,
      this.mine(),
      instanceId,
    );
  }

  selectEndTurnAbility(instanceId: string): boolean {
    return this.state.phase === 'TURN_COMPLETE' && this.selectAbility(instanceId);
  }

  targetSelectedAbility(point: number): boolean {
    return this.interaction.targetSelectedAbility(
      this.state,
      this.localAuthority.rules,
      this.mine(),
      point,
    );
  }

  cancelSelectedAbility(): void {
    this.interaction.cancelAbility();
  }

  requestBeforeRollAbility(target: AbilityTarget): RollAbilityRequest | null {
    const config = this.localAuthority.rules.variantConfig;
    const active = this.state.active;

    if (
      this.busy ||
      !config ||
      active === null ||
      !this.mine() ||
      !this.interaction.hasAbilitySelection ||
      target.type !== 'EFFECT' ||
      !this.abilityTargets().some(
        (candidate) => candidate.type === 'EFFECT' && candidate.instanceId === target.instanceId,
      )
    )
      return null;

    const activation = this.interaction.selectedActivation(target);

    if (!activation) return null;
    if (this.onlineAuthority.connected) {
      this.sendOnline(
        { type: 'playAbility', activation },
        { type: 'ABILITY', completion: 'ONLINE_UPDATE' },
      );
      this.interaction.cancelAbility();

      return { type: 'sent' };
    }

    const used = this.dispatchLocal({
      type: 'useBeforeRollAbility',
      player: active,
      activation,
    }).ok;

    if (!used) return null;

    this.interaction.cancelAbility();
    this.pickup.clear();

    return { type: 'local' };
  }

  requestRollAbility(option: RollAbilityOption): RollAbilityRequest | null {
    const config = this.localAuthority.rules.variantConfig;
    const active = this.state.active;

    if (
      this.busy ||
      !config ||
      active === null ||
      !this.mine() ||
      !this.interaction.hasAbilitySelection ||
      !this.rollAbilityOptions().some(
        (candidate) =>
          candidate.target.index === option.target.index && candidate.option === option.option,
      )
    )
      return null;

    const activation = this.interaction.selectedActivation(option.target, option.option);

    if (!activation) return null;
    if (this.onlineAuthority.connected) {
      this.sendOnline(
        { type: 'playAbility', activation },
        { type: 'ABILITY', completion: 'ONLINE_UPDATE' },
      );
      this.interaction.cancelAbility();

      return { type: 'sent' };
    }

    const randomCount = rollAbilityRandomCount(this.state, active, activation, config);

    if (randomCount === null) return null;

    const randomValues = this.localAuthority.randomValues(randomCount);
    const used = this.dispatchLocal({
      type: 'useRollAbility',
      player: active,
      activation,
      randomValues,
    }).ok;

    if (!used) return null;

    this.interaction.cancelAbility();
    this.pickup.clear();

    if (randomCount)
      this.interaction.start({ type: 'ABILITY', completion: 'LOCAL_DICE_PRESENTATION' });

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

    if (this.onlineAuthority.connected) {
      if (this.onlineAuthority.seat !== player) return false;

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
    const config = this.localAuthority.rules.variantConfig;
    const powerups = this.state.powerups;

    if (!config || !powerups) return 0;

    const kind = abilityRegistry[abilityId].kind;

    return inventoryCapacity(powerups, player, kind, config);
  }

  canRestart(locked = false): boolean {
    if (locked || this.busy) return false;

    return !this.onlineAuthority.connected || this.state.phase === 'GAME_OVER';
  }

  forfeit(locked = false): boolean {
    if (locked || this.busy || !this.onlineAuthority.connected || this.state.phase === 'GAME_OVER')
      return false;

    this.sendOnline({ type: 'forfeit' }, { type: 'FORFEIT' });

    return true;
  }

  restart(locked = false): 'local' | 'sent' | null {
    if (!this.canRestart(locked)) return null;
    if (this.onlineAuthority.connected) {
      this.sendUntrackedOnline({ type: 'restart' });

      return 'sent';
    }

    this.dispatchLocal({ type: 'restart' });
    this.pickup.clear();

    return 'local';
  }

  adopt(state: GameState, canUndo: boolean, preservePickup = false): void {
    this.onlineAuthority.acknowledge();
    this.remoteCanUndo = canUndo;
    this.localAuthority.adopt(state);
    this.interaction.adopt(this.state, preservePickup);
  }
}
