import { appendFile, readFile } from 'node:fs/promises';

const reportPath = process.argv[2] ?? 'reports/mutation/mutation.json';
let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
  const message = `Mutation report unavailable: ${error instanceof Error ? error.message : String(error)}`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Mutation testing\n\n${message}\n`);
  process.exit(0);
}

const counts = {
  Killed: 0,
  Timeout: 0,
  Survived: 0,
  NoCoverage: 0,
  RuntimeError: 0,
  CompileError: 0,
  Ignored: 0,
  Pending: 0,
};
for (const file of Object.values(report.files ?? {}))
  for (const mutant of file.mutants ?? []) {
    if (!(mutant.status in counts)) throw new Error(`Unknown mutant status: ${mutant.status}`);
    counts[mutant.status]++;
  }

const detected = counts.Killed + counts.Timeout;
const valid = detected + counts.Survived + counts.NoCoverage;
const score = valid === 0 ? 100 : (detected / valid) * 100;
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
const markdown = [
  '## Mutation testing',
  '',
  '| Score | Detected | Survived | No coverage | Total |',
  '| ---: | ---: | ---: | ---: | ---: |',
  `| ${score.toFixed(2)}% | ${detected} | ${counts.Survived} | ${counts.NoCoverage} | ${total} |`,
  '',
  `Required floor: ${report.thresholds?.break ?? 0}%.`,
  '',
].join('\n');

console.log(
  `Mutation score: ${score.toFixed(2)}% (${detected} detected, ${counts.Survived} survived, ${counts.NoCoverage} uncovered).`,
);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(
    `::notice title=Mutation score::${score.toFixed(2)}% · ${detected} detected · ${counts.Survived} survived`,
  );
}
