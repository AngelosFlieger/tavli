import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';

/**
 * Mirrors the CI verify job (build+coverage+lint+format) in one command, running the
 * independent steps concurrently. `npm run build` already typechecks, so a separate
 * `tsc --noEmit` pass would only duplicate work.
 */
const steps = [
  { name: 'build', args: ['run', 'build'] },
  { name: 'coverage', args: ['run', 'test:coverage'] },
  { name: 'lint', args: ['run', 'lint'] },
  { name: 'format', args: ['run', 'format:check'] },
];

const verbose = process.argv.includes('--verbose');

function execute(step) {
  const started = Date.now();
  const output = [];
  const child = spawn('npm', step.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    shell: process.platform === 'win32',
  });
  const collect = (chunk) => {
    const text = chunk.toString();

    output.push(text);

    if (verbose) process.stdout.write(text.replace(/^/gm, `[${step.name}] `));
  };

  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  return new Promise((resolve) => {
    child.on('error', (error) => {
      output.push(`${error.message}\n`);
      resolve({ step, ok: false, seconds: (Date.now() - started) / 1000, output });
    });
    child.on('exit', (code) =>
      resolve({
        step,
        ok: code === 0,
        seconds: (Date.now() - started) / 1000,
        output,
      }),
    );
  });
}

console.log(`Running ${steps.map((step) => step.name).join(', ')} in parallel…`);

const results = await Promise.all(steps.map(execute));

const coverageResult = results.find(({ step }) => step.name === 'coverage');

const coverageText = coverageResult?.output.join('') ?? '';

const coverageMatch = coverageText.match(
  /^\s*(?:ℹ\s+)?all files\s+\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/m,
);

const coverageSummary = coverageMatch
  ? {
      lines: Number(coverageMatch[1]),
      branches: Number(coverageMatch[2]),
      functions: Number(coverageMatch[3]),
    }
  : null;

for (const result of results) {
  const status = result.ok ? '✓' : '✗';

  console.log(`${status} ${result.step.name} (${result.seconds.toFixed(1)}s)`);

  if (!result.ok) {
    const text = result.output.join('');
    const lines = text.trimEnd().split('\n');
    const tail = lines.slice(-60);

    console.log(`\n--- ${result.step.name} output ---`);
    console.log(tail.join('\n'));
    console.log(`--- end ${result.step.name} output ---\n`);
  }
}

if (results.every((result) => result.ok)) {
  if (!coverageSummary) throw new Error('Coverage passed but its summary could not be parsed');

  console.log(
    `Coverage: ${coverageSummary.lines.toFixed(2)}% lines, ${coverageSummary.branches.toFixed(2)}% branches, ${coverageSummary.functions.toFixed(2)}% functions.`,
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        '## Test coverage',
        '',
        '| Lines | Branches | Functions |',
        '| ---: | ---: | ---: |',
        `| ${coverageSummary.lines.toFixed(2)}% | ${coverageSummary.branches.toFixed(2)}% | ${coverageSummary.functions.toFixed(2)}% |`,
        '',
        'Required floors: 89% lines, 79% branches, 87% functions.',
        '',
      ].join('\n'),
    );
    console.log(
      `::notice title=Test coverage::Lines ${coverageSummary.lines.toFixed(2)}% · Branches ${coverageSummary.branches.toFixed(2)}% · Functions ${coverageSummary.functions.toFixed(2)}%`,
    );
  }

  console.log(
    'All checks passed. Browser smoke: `npm run test:browser:local` or `npm run test:browser`.',
  );
} else {
  const failed = results.filter((result) => !result.ok).map((result) => result.step.name);

  console.error(`Checks failed: ${failed.join(', ')}`);
  process.exitCode = 1;
}
