import { spawn } from 'node:child_process';

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
  console.log(
    'All checks passed. Browser smoke: `npm run test:browser:local` or `npm run test:browser`.',
  );
} else {
  const failed = results.filter((result) => !result.ok).map((result) => result.step.name);
  console.error(`Checks failed: ${failed.join(', ')}`);
  process.exitCode = 1;
}
