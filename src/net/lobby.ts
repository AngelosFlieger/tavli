import type { Player } from '../game/rules/position';
import { initialPresentedSession, sessionMessage } from '../game/session/messages';
import type { GameState, Session } from '../game/session/state';
import {
  transitionSession,
  type SessionCommand,
  type SessionEvent,
  type SessionResult,
} from '../game/session/transition';
import { advancePendingDraft } from '../game/variant/authority';
import { rollAbilityRandomCount } from '../game/variant/roll-activation';
import { generateMovementRoll } from '../game/variant/passives/policy';
import { VARIANT_PROFILE_IDS, variantProfile } from '../game/variant/config/profiles';
import { CLASSIC_RULES, powerupsRules, type RulesContext } from '../game/variant/types';
import { isCommand, type Command, type MatchSelection, type Update } from './messages';

export type PlayerId = string;
export type ActResult = { to: PlayerId[]; update: Update };

export type SeatView = { you: Player; state: GameState; canUndo: boolean };

export type MatchSnapshot = { id: string; ids: [PlayerId, PlayerId]; session: Session };

type Seat = { match: Match; player: Player };

/** Runs the authoritative game for players this process has seated. Pairing lives in MongoDB. */
export function createLobby(
  rollDie: () => number,
  randomInt: (maximum: number) => number = (maximum) =>
    Math.min(maximum - 1, Math.floor(((rollDie() - 1) / 6) * maximum)),
) {
  const seats = new Map<PlayerId, Seat>();

  function leave(id: PlayerId): PlayerId | null {
    const seat = seats.get(id);
    if (!seat) return null;
    const opponent = seat.match.ids[seat.player === 0 ? 1 : 0];
    seats.delete(id);
    seats.delete(opponent);
    return opponent;
  }

  function act(id: PlayerId, command: unknown): ActResult | null {
    const seat = seats.get(id);
    if (!seat || !isCommand(command)) return null;
    return seat.match.act(seat.player, command, id);
  }

  function seat(id: PlayerId): SeatView | null {
    const found = seats.get(id);
    if (!found) return null;
    const update = found.match.view();
    return { you: found.player, state: update.state, canUndo: update.canUndo };
  }

  function snapshot(id: PlayerId): MatchSnapshot | null {
    const found = seats.get(id);
    if (!found) return null;
    return { id: found.match.id, ids: [...found.match.ids], session: found.match.exportSession() };
  }

  function restore(first: PlayerId, second: PlayerId, session: Session, id: string) {
    if (seats.has(first) || seats.has(second)) return false;
    const match = new Match(
      first,
      second,
      rollDie,
      randomInt,
      rulesForState(session.state),
      session,
      id,
    );
    seats.set(first, { match, player: 0 });
    seats.set(second, { match, player: 1 });
    return true;
  }

  return { leave, act, seat, snapshot, restore };
}

export function rulesForSelection(selection: MatchSelection): RulesContext {
  return selection.ruleset === 'CLASSIC'
    ? CLASSIC_RULES
    : powerupsRules(variantProfile(selection.profileId));
}

export function matchKey(rules: RulesContext): string {
  return `${rules.ruleset}:${rules.variantConfig?.hash ?? 'classic'}`;
}

export function rulesForState(state: GameState): RulesContext {
  if (state.ruleset === 'CLASSIC') return CLASSIC_RULES;
  const config = VARIANT_PROFILE_IDS.map(variantProfile).find(
    (candidate) => candidate.hash === state.variantConfigHash,
  );
  if (!config) throw new Error(`Unknown variant configuration ${state.variantConfigHash ?? ''}`);
  return powerupsRules(config);
}

class Match {
  readonly ids: [PlayerId, PlayerId];
  private session: Session;

  constructor(
    first: PlayerId,
    second: PlayerId,
    private rollDie: () => number,
    private randomInt: (maximum: number) => number,
    private rules: RulesContext,
    session: Session = initialPresentedSession(rules),
    readonly id: string = crypto.randomUUID(),
  ) {
    this.ids = [first, second];
    this.session = structuredClone(session);
  }

  exportSession(): Session {
    return structuredClone(this.session);
  }

  view(events?: SessionEvent[]): Update {
    return {
      state: structuredClone(this.session.state),
      canUndo: this.session.history.length > 0,
      ...(events?.length ? { events: structuredClone(events) } : {}),
    };
  }

  private resolve(
    command: SessionCommand,
    input = this.session,
  ): Extract<SessionResult, { ok: true }> | null {
    const result = transitionSession(input, command, this.rules);
    if (!result.ok) return null;
    const message = sessionMessage(result.session.state, result.events);
    if (message !== null) result.session.state.message = message;
    return result;
  }

  private apply(command: SessionCommand): SessionEvent[] | null {
    const result = this.resolve(command);
    if (!result) return null;
    this.session = result.session;
    return result.events;
  }

  act(player: Player, command: Command, sender: PlayerId): ActResult {
    const rejected = () => ({ to: [sender], update: this.view() });
    if (command.type === 'restart') {
      const events = this.apply({ type: 'restart' });
      if (!events) return rejected();
      return { to: [...this.ids], update: { ...this.view(events), resetDice: true } };
    }
    if (command.type === 'pickAbility') {
      const events = this.apply({
        type: 'pickAbility',
        player,
        abilityId: command.abilityId,
        replaceInstanceId: command.replaceInstanceId,
      });
      return events ? { to: [...this.ids], update: this.view(events) } : rejected();
    }
    if (player !== this.session.state.active) return rejected();
    if (command.type === 'playAbility') {
      if (!this.rules.variantConfig) return rejected();
      if (this.session.state.phase === 'WAITING_FOR_ROLL') {
        const events = this.apply({
          type: 'useBeforeRollAbility',
          player,
          activation: command.activation,
        });
        return events ? { to: [...this.ids], update: this.view(events) } : rejected();
      }
      const randomCount = rollAbilityRandomCount(
        this.session.state,
        player,
        command.activation,
        this.rules.variantConfig,
      );
      if (randomCount === null) return rejected();
      const randomValues = Array.from({ length: randomCount }, () => this.rollDie());
      const events = this.apply({
        type: 'useRollAbility',
        player,
        activation: command.activation,
        randomValues,
      });
      if (!events) return rejected();
      return {
        to: [...this.ids],
        update: {
          ...this.view(events),
          ...(randomCount
            ? {
                dice: this.session.state.roll as [number, number],
                rerolledDie:
                  command.activation.target.type === 'DIE'
                    ? command.activation.target.index
                    : undefined,
              }
            : {}),
        },
      };
    }
    if (command.type === 'roll') {
      const started = this.resolve({ type: 'beginRoll' });
      if (!started) return rejected();
      let dice: [number, number];
      try {
        dice = this.rules.variantConfig
          ? generateMovementRoll(
              started.session.state,
              player,
              this.rules.variantConfig,
              this.rollDie,
              this.randomInt,
            )
          : [this.rollDie(), this.rollDie()];
      } catch {
        return rejected();
      }
      const rolled = this.resolve({ type: 'receiveRoll', values: dice }, started.session);
      if (!rolled) return rejected();
      this.session = rolled.session;
      return {
        to: [...this.ids],
        update: { ...this.view([...started.events, ...rolled.events]), dice },
      };
    }
    if (command.type === 'move') {
      const events = this.apply({ type: 'move', sequence: command.sequence });
      if (!events) return rejected();
      return {
        to: [...this.ids],
        update: { ...this.view(events), sequence: command.sequence },
      };
    }
    if (command.type === 'undo') {
      const events = this.apply({ type: 'undo' });
      return events ? { to: [...this.ids], update: this.view(events) } : rejected();
    }
    const events = this.apply({ type: 'endTurn', ability: command.ability });
    if (!events) return rejected();
    const advanced = advancePendingDraft(this.session, this.rules, this.randomInt);
    this.session = advanced.session;
    return {
      to: [...this.ids],
      update: {
        ...this.view([...events, ...advanced.events]),
        ...(advanced.orderRolls.length ? { draftRolls: advanced.orderRolls } : {}),
      },
    };
  }
}
