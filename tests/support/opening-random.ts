/** Deterministic one-call-per-die source that always resolves an opening as 6–1. */
export function nonTiedOpeningRandom() {
  let player = 0;

  return (maximum: number) => {
    const value = player++ % 2 === 0 ? maximum - 1 : 0;

    return value;
  };
}
