import { legalMoves, spendDie } from '../rules/moves';
import { outcome } from '../rules/outcome';
import {
  applyMove,
  other,
  owner,
  type Move,
  type Outcome,
  type Player,
  type Position,
} from '../rules/position';
import { canUndoInPhase, nextPhase } from './phase';
import { initialGameState, type GameState, type Session } from './state';
import { pickDraftAbility, resolveDraftOrder, validateDraftOffer } from '../variant/draft';
import { CLASSIC_RULES, type AbilityId, type RulesContext } from '../variant/types';
import type { AbilityActivation } from '../variant/types';
import {
  activateEndTurnAbility,
  expireNextDraftEffects,
  expireTargetTurnEffects,
  pruneInvalidEffects,
} from '../variant/activation';
import { activateRollAbility } from '../variant/roll-activation';
import {
  advancePassiveCountersAtTurnEnd,
  movementRollSource,
  movementTokensForRoll,
  passiveStallEvents,
} from '../variant/passives/policy';
import { resolvePendingRollEffects } from '../variant/powerups/roll-effects';
import { activateBeforeRollAbility } from '../variant/powerups/before-roll';

export type SessionCommand =
  | { type: 'beginRoll' }
  | { type: 'receiveRoll'; values: number[] }
  | { type: 'move'; sequence: Move[] }
  | { type: 'undo' }
  | { type: 'endTurn'; ability?: AbilityActivation }
  | { type: 'restart' }
  | { type: 'openDraft'; offer: AbilityId[] }
  | { type: 'resolveDraftOrder'; rolls: [number, number] }
  | {
      type: 'useRollAbility';
      player: Player;
      activation: AbilityActivation;
      randomValues: number[];
    }
  | { type: 'useBeforeRollAbility'; player: Player; activation: AbilityActivation }
  | {
      type: 'pickAbility';
      player: Player;
      abilityId: AbilityId;
      replaceInstanceId?: string;
    };

export type SessionEvent =
  | { type: 'GameReset' }
  | { type: 'RollStarted'; player: Player }
  | { type: 'OpeningRollPassed' }
  | { type: 'OpeningRollTied' }
  | { type: 'OpeningWinnerChosen'; player: Player }
  | { type: 'DiceRolled'; player: Player; values: number[] }
  | { type: 'NoLegalMoves' }
  | { type: 'MovesAvailable' }
  | { type: 'CheckerMoved'; checker: number; from: number; to: number; die: number }
  | { type: 'CheckerPinned'; checker: number; victim: number; point: number }
  | { type: 'CheckerBorneOff'; checker: number; player: Player }
  | { type: 'MovesComplete' }
  | { type: 'GameEnded'; outcome: Outcome }
  | { type: 'MoveUndone' }
  | { type: 'TurnEnded'; player: Player; next: Player }
  | { type: 'RoundCompleted'; round: number }
  | { type: 'DraftDue'; round: number }
  | { type: 'DraftOpened'; offer: AbilityId[] }
  | { type: 'DraftOrderRolled'; rolls: [number, number] }
  | { type: 'DraftOrderTied'; rolls: [number, number] }
  | { type: 'DraftOrderChosen'; first: Player }
  | { type: 'AbilityPicked'; player: Player; abilityId: AbilityId }
  | { type: 'AbilityReplaced'; player: Player; abilityId: AbilityId }
  | { type: 'DraftCompleted' }
  | {
      type: 'AbilityUsed';
      player: Player;
      abilityId: AbilityId;
      target: AbilityActivation['target'];
    }
  | {
      type: 'DiceModified';
      abilityId: 'recast' | 'nudge' | 'opportunist' | 'jinx';
      dieIndex: 0 | 1;
      before: number;
      after: number;
    }
  | { type: 'EffectExpired'; abilityId: AbilityId }
  | {
      type: 'EffectsRemoved';
      abilityId: 'clearSkies';
      removed: { instanceId: string; abilityId: AbilityId }[];
    }
  | { type: 'FocusGained'; player: Player; focus: number };

export type SessionResult =
  | { ok: true; session: Session; events: SessionEvent[]; stages?: Position[] }
  | {
      ok: false;
      reason:
        | 'phase'
        | 'invalid_roll'
        | 'illegal_move'
        | 'no_history'
        | 'rules_mismatch'
        | 'invalid_draft'
        | 'invalid_pick'
        | 'invalid_ability';
    };

const rejected = (reason: Extract<SessionResult, { ok: false }>['reason']): SessionResult => ({
  ok: false,
  reason,
});

// The only authoritative session mutation path. Inputs and saved history are never changed.
export function transitionSession(
  input: Session,
  command: SessionCommand,
  rules: RulesContext = CLASSIC_RULES,
): SessionResult {
  if (
    input.state.ruleset !== rules.ruleset ||
    input.state.variantConfigHash !== (rules.variantConfig?.hash ?? null)
  )
    return rejected('rules_mismatch');

  if (command.type === 'restart')
    return {
      ok: true,
      session: { state: initialGameState(rules), history: [] },
      events: [{ type: 'GameReset' }],
    };

  const state: GameState = structuredClone(input.state);
  const history = [...input.history];
  const active = state.active;

  if (command.type === 'useBeforeRollAbility') {
    if (!rules.variantConfig || active === null || command.player !== active)
      return rejected('invalid_ability');
    const result = activateBeforeRollAbility(
      state,
      active,
      command.activation,
      rules.variantConfig,
    );
    if (!result) return rejected('invalid_ability');
    return {
      ok: true,
      session: { state, history: [] },
      events: [
        {
          type: 'AbilityUsed',
          player: active,
          abilityId: result.abilityId,
          target: command.activation.target,
        },
        {
          type: 'EffectsRemoved',
          abilityId: result.abilityId,
          removed: result.removed.map((effect) => ({
            instanceId: effect.instanceId,
            abilityId: effect.abilityId,
          })),
        },
      ],
    };
  }

  if (command.type === 'openDraft') {
    const powerups = state.powerups;
    if (
      !rules.variantConfig ||
      state.phase !== 'DRAFT_ORDER' ||
      powerups?.draft?.stage !== 'AWAITING_OFFER' ||
      !validateDraftOffer(powerups, command.offer, rules.variantConfig)
    )
      return rejected('invalid_draft');
    powerups.draft = {
      stage: 'ORDER_ROLL',
      offer: [...command.offer],
      resumePlayer: powerups.draft.resumePlayer,
      attempts: [],
    };
    return {
      ok: true,
      session: { state, history: [] },
      events: [{ type: 'DraftOpened', offer: [...command.offer] }],
    };
  }

  if (command.type === 'resolveDraftOrder') {
    const powerups = state.powerups;
    if (
      !rules.variantConfig ||
      state.phase !== 'DRAFT_ORDER' ||
      powerups?.draft?.stage !== 'ORDER_ROLL'
    )
      return rejected('phase');
    let result: ReturnType<typeof resolveDraftOrder>;
    try {
      result = resolveDraftOrder(powerups.draft, command.rolls, rules.variantConfig);
    } catch {
      return rejected('invalid_roll');
    }
    powerups.draft = result.draft;
    const events: SessionEvent[] = [{ type: 'DraftOrderRolled', rolls: [...command.rolls] }];
    if (result.tied) events.push({ type: 'DraftOrderTied', rolls: [...command.rolls] });
    else {
      state.phase = 'DRAFT_PICK';
      events.push({ type: 'DraftOrderChosen', first: result.first });
    }
    return { ok: true, session: { state, history: [] }, events };
  }

  if (command.type === 'pickAbility') {
    const powerups = state.powerups;
    if (!rules.variantConfig || state.phase !== 'DRAFT_PICK' || !powerups) return rejected('phase');
    const picked = pickDraftAbility(
      powerups,
      command.player,
      command.abilityId,
      command.replaceInstanceId,
      rules.variantConfig,
    );
    if (!picked.ok) return rejected('invalid_pick');
    const events: SessionEvent[] = [
      { type: 'AbilityPicked', player: command.player, abilityId: command.abilityId },
    ];
    if (picked.replacedAbilityId)
      events.push({
        type: 'AbilityReplaced',
        player: command.player,
        abilityId: picked.replacedAbilityId,
      });
    if (picked.finished) {
      state.phase = 'WAITING_FOR_ROLL';
      state.active = picked.resumePlayer;
      powerups.draft = null;
      events.push({ type: 'DraftCompleted' });
    }
    return { ok: true, session: { state, history: [] }, events };
  }

  if (command.type === 'useRollAbility') {
    if (!rules.variantConfig || active === null || command.player !== active)
      return rejected('invalid_ability');
    const modifier = activateRollAbility(
      state,
      active,
      command.activation,
      command.randomValues,
      rules.variantConfig,
    );
    if (!modifier) return rejected('invalid_ability');
    const events: SessionEvent[] = [
      {
        type: 'AbilityUsed',
        player: active,
        abilityId: modifier.abilityId,
        target: command.activation.target,
      },
      {
        type: 'DiceModified',
        abilityId: modifier.abilityId,
        dieIndex: modifier.dieIndex,
        before: modifier.before,
        after: modifier.after,
      },
    ];
    if (legalMoves(state, active, state.remaining).length) events.push({ type: 'MovesAvailable' });
    else {
      state.phase = nextPhase(state.phase, 'movesExhausted')!;
      events.push({ type: 'NoLegalMoves' });
    }
    return { ok: true, session: { state, history: [] }, events };
  }

  if (command.type === 'beginRoll') {
    const phase = nextPhase(state.phase, 'beginRoll');
    if (!phase || active === null) return rejected('phase');
    state.phase = phase;
    return {
      ok: true,
      session: { state, history },
      events: [{ type: 'RollStarted', player: active }],
    };
  }

  if (command.type === 'receiveRoll') {
    if (!['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(state.phase) || active === null)
      return rejected('phase');
    const values = command.values;
    if (values.length !== 2 || values.some((v) => !Number.isInteger(v) || v < 1 || v > 6))
      return rejected('invalid_roll');
    state.roll = [...values];
    state.diceModifiers = [];
    state.rollSource =
      !state.opening && rules.variantConfig ? movementRollSource(state, active) : null;
    if (state.opening) {
      state.openingRolls[active] = [...values];
      if (active === 0) {
        state.active = 1;
        state.phase = nextPhase(state.phase, 'needOpeningRoll')!;
        return {
          ok: true,
          session: { state, history: [] },
          events: [{ type: 'OpeningRollPassed' }],
        };
      }
      const totals = state.openingRolls.map((pair) => pair!.reduce((sum, value) => sum + value, 0));
      if (totals[0] === totals[1]) {
        state.active = 0;
        state.openingRolls = [null, null];
        state.phase = nextPhase(state.phase, 'needOpeningRoll')!;
        return { ok: true, session: { state, history: [] }, events: [{ type: 'OpeningRollTied' }] };
      }
      state.active = totals[0] > totals[1] ? 0 : 1;
      state.opening = false;
      state.phase = nextPhase(state.phase, 'openingComplete')!;
      return {
        ok: true,
        session: { state, history: [] },
        events: [{ type: 'OpeningWinnerChosen', player: state.active }],
      };
    }
    state.openingRolls = [null, null];
    state.remaining = rules.variantConfig
      ? movementTokensForRoll(state, active, values as [number, number], rules.variantConfig)
      : values[0] === values[1]
        ? Array(4).fill(values[0])
        : [...values];
    state.phase = nextPhase(state.phase, 'rollReady')!;
    const events: SessionEvent[] = [{ type: 'DiceRolled', player: active, values: [...values] }];
    if (rules.variantConfig) {
      const resolution = resolvePendingRollEffects(state, active);
      for (const modifier of resolution.modifiers)
        events.push({
          type: 'DiceModified',
          abilityId: modifier.abilityId,
          dieIndex: modifier.dieIndex,
          before: modifier.before,
          after: modifier.after,
        });
    }
    if (legalMoves(state, active, state.remaining).length) events.push({ type: 'MovesAvailable' });
    else {
      if (state.powerups && rules.variantConfig) {
        events.push(...passiveStallEvents(state.powerups, active, rules.variantConfig));
      }
      state.phase = nextPhase(state.phase, 'movesExhausted')!;
      events.push({ type: 'NoLegalMoves' });
    }
    return { ok: true, session: { state, history: [] }, events };
  }

  if (command.type === 'move') {
    if (state.phase !== 'WAITING_FOR_MOVE' || active === null) return rejected('phase');
    const sequence = command.sequence;
    if (!sequence.length) return rejected('illegal_move');
    const first = sequence[0];
    if (!Number.isInteger(first.from) || first.from < 0 || first.from >= state.board.length)
      return rejected('illegal_move');
    const checker = state.board[first.from].at(-1);
    if (checker === undefined || owner(checker) !== active) return rejected('illegal_move');
    const stages: Position[] = [];
    const events: SessionEvent[] = [];
    // Preserve variant effect data on intermediate positions so every step is checked by the
    // same active move policy as the initial landing.
    let position: Position = structuredClone(state);
    let left = [...state.remaining];
    for (const move of sequence) {
      if (
        !Number.isInteger(move.from) ||
        move.from < 0 ||
        move.from >= position.board.length ||
        !Number.isInteger(move.to) ||
        move.to < -1 ||
        move.to >= position.board.length ||
        position.board[move.from].at(-1) !== checker ||
        !legalMoves(position, active, left).some(
          (allowed) =>
            allowed.from === move.from && allowed.to === move.to && allowed.die === move.die,
        )
      )
        return rejected('illegal_move');
      const victim = move.to === -1 ? undefined : position.board[move.to].at(-1);
      const pins =
        move.to !== -1 &&
        position.board[move.to].length === 1 &&
        victim !== undefined &&
        owner(victim) !== active;
      position = applyMove(position, active, move);
      left = spendDie(left, move.die);
      stages.push(position);
      events.push({ type: 'CheckerMoved', checker, ...move });
      if (pins) events.push({ type: 'CheckerPinned', checker, victim: victim!, point: move.to });
      if (move.to === -1) events.push({ type: 'CheckerBorneOff', checker, player: active });
      if (outcome(position) && stages.length !== sequence.length) return rejected('illegal_move');
    }
    history.push(structuredClone(input.state));
    state.board = position.board;
    state.off = position.off;
    state.remaining = left;
    for (const effect of pruneInvalidEffects(state))
      events.push({ type: 'EffectExpired', abilityId: effect.abilityId });
    if (state.powerups) state.powerups.checkerMovedThisTurn = true;
    const result = outcome(state);
    if (result) {
      state.outcome = result;
      state.phase = nextPhase(state.phase, 'gameFinished')!;
      events.push({ type: 'GameEnded', outcome: result });
    } else if (legalMoves(state, active, state.remaining).length) {
      events.push({ type: 'MovesAvailable' });
    } else {
      state.phase = nextPhase(state.phase, 'movesExhausted')!;
      events.push({ type: 'MovesComplete' });
    }
    return { ok: true, session: { state, history }, events, stages };
  }

  if (command.type === 'undo') {
    if (!canUndoInPhase(state.phase)) return rejected('phase');
    if (!history.length) return rejected('no_history');
    return {
      ok: true,
      session: { state: structuredClone(history.at(-1)!), history: history.slice(0, -1) },
      events: [{ type: 'MoveUndone' }],
    };
  }

  if (command.type === 'endTurn') {
    const phase = nextPhase(state.phase, 'endTurn');
    if (!phase || active === null) return rejected('phase');
    const events: SessionEvent[] = [];
    if (command.ability) {
      if (!rules.variantConfig) return rejected('invalid_ability');
      const effect = activateEndTurnAbility(state, active, command.ability, rules.variantConfig);
      if (!effect) return rejected('invalid_ability');
      events.push({
        type: 'AbilityUsed',
        player: active,
        abilityId: effect.abilityId,
        target: effect.target,
      });
    }
    for (const effect of expireTargetTurnEffects(state, active))
      events.push({ type: 'EffectExpired', abilityId: effect.abilityId });
    const next = other(active);
    state.phase = phase;
    state.active = next;
    state.remaining = [];
    state.diceModifiers = [];
    state.rollSource = null;
    events.push({ type: 'TurnEnded', player: active, next });
    if (state.powerups && rules.variantConfig) {
      const powerups = state.powerups;
      const usedPowerupThisTurn = powerups.powerupsUsedThisTurn > 0;
      powerups.actedThisRound[active] = true;
      advancePassiveCountersAtTurnEnd(powerups, active, usedPowerupThisTurn, rules.variantConfig);
      powerups.powerupsUsedThisTurn = 0;
      powerups.checkerMovedThisTurn = false;
      if (powerups.actedThisRound.every(Boolean)) {
        powerups.completedRounds++;
        powerups.actedThisRound = [false, false];
        events.push({ type: 'RoundCompleted', round: powerups.completedRounds });
        if (powerups.completedRounds % rules.variantConfig.draft.intervalRounds === 0) {
          for (const effect of expireNextDraftEffects(state))
            events.push({ type: 'EffectExpired', abilityId: effect.abilityId });
          state.phase = 'DRAFT_ORDER';
          powerups.draft = { stage: 'AWAITING_OFFER', resumePlayer: next };
          events.push({ type: 'DraftDue', round: powerups.completedRounds });
        }
      }
    }
    return {
      ok: true,
      session: { state, history: [] },
      events,
    };
  }
  return rejected('phase');
}
