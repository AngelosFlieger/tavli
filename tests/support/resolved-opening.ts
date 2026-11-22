import { initialPresentedSession } from '../../src/game/session/messages';
import type { GameState, Session } from '../../src/game/session/state';
import { transitionSession } from '../../src/game/session/transition';
import { CLASSIC_RULES, type RulesContext } from '../../src/game/variant/types';

export function resolvedOpeningSession(rules: RulesContext = CLASSIC_RULES): Session {
  const result = transitionSession(
    initialPresentedSession(rules),
    { type: 'resolveOpening', attempts: [[6, 1]] },
    rules,
  );

  if (!result.ok) throw new Error('Opening fixture could not be resolved');

  return result.session;
}

export function resolvedOpeningState(rules: RulesContext = CLASSIC_RULES): GameState {
  return structuredClone(resolvedOpeningSession(rules).state);
}
