import type { RandomInt } from '../random';
import type { RulesContext } from '../variant/types';
import type { Session } from './state';
import { transitionSession, type SessionEvent } from './transition';

export type OpeningResolution = {
  session: Session;
  events: SessionEvent[];
  attempts: [number, number][];
  winner: 0 | 1;
};

/** Samples both owned opening dice together until one player wins, then applies one transition. */
export function resolveAutomaticOpening(
  session: Session,
  rules: RulesContext,
  randomInt: RandomInt,
): OpeningResolution | null {
  if (session.state.phase !== 'OPENING' || session.state.opening.status !== 'PENDING') return null;
  const attempts: [number, number][] = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    attempts.push([randomInt(6) + 1, randomInt(6) + 1]);
    if (attempts.at(-1)![0] !== attempts.at(-1)![1]) break;
  }
  if (attempts.at(-1)![0] === attempts.at(-1)![1]) return null;
  const result = transitionSession(session, { type: 'resolveOpening', attempts }, rules);
  if (!result.ok) return null;
  return {
    session: result.session,
    events: result.events,
    attempts,
    winner: result.session.state.active!,
  };
}
