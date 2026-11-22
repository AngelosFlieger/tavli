import type { Player } from '../game/rules/position';
import type { Outcome } from '../game/rules/position';
import { initialPresentedSession } from '../game/session/messages';
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
import { rulesForState } from '../game/variant/rules-context';
import type { RulesContext } from '../game/variant/types';
import { isCommand, type Command, type Update } from './messages';
import {
  advanceClock,
  DISABLED_CLOCK,
  pauseClock,
  resumeClock,
  startClock,
  type ClockConfig,
} from '../game/clock';

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
  clockConfig: ClockConfig = DISABLED_CLOCK,
  now: () => number = () => Date.now(),
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

  function restore(
    first: PlayerId,
    second: PlayerId,
    session: Session,
    id: string,
    rules: RulesContext = rulesForState(session.state),
  ) {
    if (seats.has(first) || seats.has(second)) return false;
    if (
      session.state.ruleset !== rules.ruleset ||
      session.state.variantConfigHash !== (rules.variantConfig?.hash ?? null)
    )
      return false;
    const match = new Match(
      first,
      second,
      rollDie,
      randomInt,
      rules,
      session,
      id,
      clockConfig,
      now,
    );
    seats.set(first, { match, player: 0 });
    seats.set(second, { match, player: 1 });
    return true;
  }

  function end(id: PlayerId, outcome: Outcome): Update | null {
    const found = seats.get(id);
    if (!found) return null;
    return found.match.end(outcome);
  }

  function pause(id: PlayerId): void {
    const found = seats.get(id);
    if (found) found.match.pauseClock(now());
  }

  function resume(id: PlayerId): void {
    const found = seats.get(id);
    if (found) found.match.resumeClock(now());
  }

  return { leave, act, end, pause, resume, seat, snapshot, restore };
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
    private clockConfig: ClockConfig = DISABLED_CLOCK,
    private now: () => number = () => Date.now(),
  ) {
    this.ids = [first, second];
    this.session = structuredClone(session);
    if (this.session.state.clock === null && this.session.state.phase !== 'GAME_OVER')
      this.session.state.clock = startClock(clockConfig, this.session.state.phase, this.now());
  }

  pauseClock(now = this.now()): void {
    this.session.state.clock = pauseClock(this.session.state.clock, now);
  }

  resumeClock(now = this.now()): void {
    this.session.state.clock = resumeClock(this.session.state.clock, now);
  }

  exportSession(): Session {
    return structuredClone(this.session);
  }

  view(events?: SessionEvent[]): Update {
    return {
      state: structuredClone(this.session.state),
      canUndo: this.session.history.length > 0,
      presentations: [],
      ...(events?.length ? { events: structuredClone(events) } : {}),
    };
  }

  end(outcome: Outcome): Update {
    const events: SessionEvent[] = [{ type: 'GameEnded', outcome }];
    this.session = {
      state: {
        ...structuredClone(this.session.state),
        phase: 'GAME_OVER',
        outcome: structuredClone(outcome),
        clock: null,
      },
      history: [],
    };
    return this.view(events);
  }

  private resolve(
    command: SessionCommand,
    input = this.session,
  ): Extract<SessionResult, { ok: true }> | null {
    const result = transitionSession(input, command, this.rules);
    if (!result.ok) return null;
    return result;
  }

  private apply(command: SessionCommand): SessionEvent[] | null {
    const previous = this.session.state.phase;
    const result = this.resolve(command);
    if (!result) return null;
    this.session = result.session;
    this.session.state.clock = advanceClock(
      this.session.state.clock,
      previous,
      this.session.state.phase,
      this.clockConfig,
      this.now(),
    );
    return result.events;
  }

  act(player: Player, command: Command, sender: PlayerId): ActResult {
    const rejected = () => ({ to: [sender], update: this.view() });
    if (command.type === 'restart') {
      const events = this.apply({ type: 'restart' });
      if (!events) return rejected();
      return {
        to: [...this.ids],
        update: {
          ...this.view(events),
          presentations: [{ type: 'RESET_DICE', blocking: false }],
        },
      };
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
    if (command.type === 'forfeit') return rejected();
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
                presentations: [
                  {
                    type: 'DICE' as const,
                    blocking: true as const,
                    values: this.session.state.roll as [number, number],
                    ...(command.activation.target.type === 'DIE'
                      ? { rerolledDie: command.activation.target.index }
                      : {}),
                  },
                ],
              }
            : {}),
        },
      };
    }
    if (command.type === 'roll') {
      if (this.session.state.phase !== 'WAITING_FOR_ROLL') return rejected();
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
        update: {
          ...this.view([...started.events, ...rolled.events]),
          presentations: [{ type: 'DICE', blocking: true, values: dice }],
        },
      };
    }
    if (command.type === 'move') {
      const events = this.apply({ type: 'move', sequence: command.sequence });
      if (!events) return rejected();
      return {
        to: [...this.ids],
        update: {
          ...this.view(events),
          presentations: [{ type: 'MOVE', blocking: true, sequence: command.sequence }],
        },
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
      update: this.view([...events, ...advanced.events]),
    };
  }
}
