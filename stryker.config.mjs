/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: [
    'src/game/rules/position.ts',
    'src/game/rules/moves.ts',
    'src/game/rules/outcome.ts',
    'src/game/session/opening-authority.ts',
  ],
  testRunner: 'command',
  commandRunner: {
    command:
      'node --import=tsx --test tests/game.test.ts tests/opening-authority.test.ts tests/variant-session.test.ts',
  },
  coverageAnalysis: 'off',
  concurrency: 4,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  thresholds: {
    high: 90,
    low: 80,
    break: 80,
  },
};
