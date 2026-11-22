import { legalMoves } from '../game/rules/moves';
import type { Move } from '../game/rules/position';
import type { GameState } from '../game/session/state';
import { endTurnAbilityTargets } from '../game/variant/activation';
import { beforeRollAbilityTargets } from '../game/variant/powerups/before-roll';
import { rollAbilityOptions } from '../game/variant/roll-activation';
import type {
  AbilityActivation,
  AbilityInstance,
  AbilityTarget,
  RollAbilityOption,
  RulesContext,
} from '../game/variant/types';
import { PickupSelection } from './pickup-selection';

export type InteractionOperation =
  | { type: 'IDLE' }
  | { type: 'ROLL'; authority: 'LOCAL'; forced: [number, number] | null }
  | { type: 'ROLL'; authority: 'ONLINE' }
  | { type: 'MOVE'; authority: 'LOCAL' | 'ONLINE' }
  | { type: 'DRAFT_PICK' }
  | { type: 'UNDO' }
  | { type: 'END_TURN' }
  | { type: 'FORFEIT' }
  | { type: 'ABILITY'; completion: 'ONLINE_UPDATE' | 'LOCAL_DICE_PRESENTATION' };

export type ActiveInteractionOperation = Exclude<InteractionOperation, { type: 'IDLE' }>;

type AbilitySelection = {
  instanceId: string;
  target?: AbilityActivation['target'];
  option?: AbilityActivation['option'];
};

/** Owns transient player interaction state; it never advances authoritative state. */
export class InteractionController {
  readonly pickup = new PickupSelection();
  private current: InteractionOperation = { type: 'IDLE' };
  private abilitySelection: AbilitySelection | null = null;
  private moveKey = '';
  private cachedMoves: Move[] = [];

  get operation(): InteractionOperation {
    return this.current;
  }

  get busy(): boolean {
    return this.current.type !== 'IDLE';
  }

  get hasAbilitySelection(): boolean {
    return this.abilitySelection !== null;
  }

  get selectedAbilityTarget(): AbilityActivation['target'] | null {
    return this.abilitySelection?.target ?? null;
  }

  get selectedAbilityInstanceId(): string | undefined {
    return this.abilitySelection?.instanceId;
  }

  start(operation: ActiveInteractionOperation): void {
    this.current = operation;
  }

  finish(): void {
    this.current = { type: 'IDLE' };
  }

  takeForcedLocalRoll(): [number, number] | null {
    if (this.current.type !== 'ROLL' || this.current.authority !== 'LOCAL') return null;
    const values = this.current.forced;
    this.current = { ...this.current, forced: null };
    return values;
  }

  moves(state: GameState): Move[] {
    if (state.active === null || state.phase !== 'WAITING_FOR_MOVE') return [];
    const key = JSON.stringify([
      state.board,
      state.remaining,
      state.active,
      state.powerups?.activeEffects,
    ]);
    if (key !== this.moveKey) {
      this.moveKey = key;
      this.cachedMoves = legalMoves(state, state.active, state.remaining);
    }
    return this.cachedMoves;
  }

  pickAt(point: number, state: GameState, mine: boolean): number | null {
    if (this.busy || this.abilitySelection || !mine) return null;
    return this.pickup.pickAt(point, state);
  }

  selectedAbility(state: GameState): AbilityInstance | null {
    const active = state.active;
    if (active === null || !this.abilitySelection || !state.powerups) return null;
    const loadout = state.powerups.loadouts[active];
    return (
      [...loadout.powerups, ...loadout.passives].find(
        (instance) => instance.instanceId === this.abilitySelection!.instanceId,
      ) ?? null
    );
  }

  abilityTargets(state: GameState, rules: RulesContext, mine: boolean, instanceId?: string) {
    const selected = instanceId ?? this.abilitySelection?.instanceId;
    const config = rules.variantConfig;
    const active = state.active;
    if (!selected || !config || active === null || !mine) return [];
    return [
      ...beforeRollAbilityTargets(state, active, selected, config),
      ...endTurnAbilityTargets(state, active, selected, config),
    ];
  }

  abilityTargetPoints(
    state: GameState,
    rules: RulesContext,
    mine: boolean,
    instanceId?: string,
  ): number[] {
    return this.abilityTargets(state, rules, mine, instanceId).flatMap((target) =>
      target.type === 'POINT' ? [target.point] : [],
    );
  }

  rollAbilityOptions(
    state: GameState,
    rules: RulesContext,
    mine: boolean,
    instanceId?: string,
  ): RollAbilityOption[] {
    const selected = instanceId ?? this.abilitySelection?.instanceId;
    const config = rules.variantConfig;
    const active = state.active;
    if (!selected || !config || active === null || !mine || this.pickup.items.length) return [];
    return rollAbilityOptions(state, active, selected, config);
  }

  abilityIsPlayable(
    state: GameState,
    rules: RulesContext,
    mine: boolean,
    instanceId: string,
  ): boolean {
    return (
      this.abilityTargets(state, rules, mine, instanceId).length > 0 ||
      this.rollAbilityOptions(state, rules, mine, instanceId).length > 0
    );
  }

  selectAbility(state: GameState, rules: RulesContext, mine: boolean, instanceId: string): boolean {
    if (this.busy || !mine || !this.abilityIsPlayable(state, rules, mine, instanceId)) return false;
    const targets = this.abilityTargets(state, rules, mine, instanceId);
    const onlyTarget =
      state.phase === 'TURN_COMPLETE' && targets.length === 1 && targets[0].type !== 'POINT'
        ? targets[0]
        : undefined;
    this.abilitySelection = { instanceId, ...(onlyTarget ? { target: onlyTarget } : {}) };
    return true;
  }

  targetSelectedAbility(
    state: GameState,
    rules: RulesContext,
    mine: boolean,
    point: number,
  ): boolean {
    if (!this.abilitySelection || !this.abilityTargetPoints(state, rules, mine).includes(point))
      return false;
    this.abilitySelection.target = { type: 'POINT', point };
    return true;
  }

  selectedActivation(
    target?: AbilityTarget,
    option?: AbilityActivation['option'],
  ): AbilityActivation | null {
    if (!this.abilitySelection) return null;
    const selectedTarget = target ?? this.abilitySelection.target;
    if (!selectedTarget) return null;
    return {
      instanceId: this.abilitySelection.instanceId,
      target: selectedTarget,
      ...(option ? { option } : {}),
    };
  }

  cancelAbility(): void {
    this.abilitySelection = null;
  }

  adopt(state: GameState, preservePickup: boolean): void {
    this.finish();
    this.cancelAbility();
    this.moveKey = '';
    if (preservePickup) this.pickup.revalidate(state);
    else this.pickup.clear();
  }
}
