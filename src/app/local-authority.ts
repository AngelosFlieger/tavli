import type { RandomInt } from '../game/random';
import { initialPresentedSession } from '../game/session/messages';
import { resolveAutomaticOpening, type OpeningResolution } from '../game/session/opening-authority';
import type { GameState, Session } from '../game/session/state';
import {
  transitionSession,
  type SessionCommand,
  type SessionEvent,
  type SessionResult,
} from '../game/session/transition';
import { advancePendingDraft, secureRandomInt } from '../game/variant/authority';
import { generateMovementRoll } from '../game/variant/passives/policy';
import { CLASSIC_RULES, type RulesContext } from '../game/variant/types';

export interface LocalAuthorityPort {
  readonly state: GameState;
  readonly rules: RulesContext;
  readonly canUndo: boolean;
  configure(rules: RulesContext, randomInt?: RandomInt): void;
  reset(rules?: RulesContext): void;
  adopt(state: GameState): void;
  transition(command: SessionCommand): SessionResult;
  resolveOpening(): OpeningResolution | null;
  advanceDraft(): SessionEvent[];
  movementRoll(): [number, number] | null;
  randomValues(count: number): number[];
}

/** Owns the local session, deterministic transitions, history, and authority randomness. */
export class LocalAuthority implements LocalAuthorityPort {
  private session: Session;

  constructor(
    private context: RulesContext = CLASSIC_RULES,
    private randomInt: RandomInt = secureRandomInt,
  ) {
    this.session = initialPresentedSession(context);
  }

  get state(): GameState {
    return this.session.state;
  }

  get rules(): RulesContext {
    return this.context;
  }

  get canUndo(): boolean {
    return this.session.history.length > 0;
  }

  configure(rules: RulesContext, randomInt: RandomInt = secureRandomInt): void {
    this.context = rules;
    this.randomInt = randomInt;
    this.session = initialPresentedSession(rules);
  }

  reset(rules: RulesContext = this.context): void {
    this.context = rules;
    this.session = initialPresentedSession(rules);
  }

  adopt(state: GameState): void {
    this.session = { state: structuredClone(state), history: [] };
  }

  transition(command: SessionCommand): SessionResult {
    const result = transitionSession(this.session, command, this.context);

    if (!result.ok) return result;

    this.session = result.session;

    return result;
  }

  resolveOpening(): OpeningResolution | null {
    const resolution = resolveAutomaticOpening(this.session, this.context, this.randomInt);

    if (!resolution) return null;

    this.session = resolution.session;

    return resolution;
  }

  advanceDraft(): SessionEvent[] {
    const advanced = advancePendingDraft(this.session, this.context, this.randomInt);

    this.session = advanced.session;

    return advanced.events;
  }

  movementRoll(): [number, number] | null {
    const active = this.state.active;

    if (active === null) return null;

    const config = this.context.variantConfig;

    return config
      ? generateMovementRoll(
          this.state,
          active,
          config,
          () => this.randomInt(6) + 1,
          this.randomInt,
        )
      : [this.randomInt(6) + 1, this.randomInt(6) + 1];
  }

  randomValues(count: number): number[] {
    return Array.from({ length: count }, () => this.randomInt(6) + 1);
  }
}
