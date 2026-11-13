import { build } from 'esbuild';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'plakoto-tests-'));
try {
  const target = join(directory, 'tests.mjs');
  const testFiles = (await readdir('tests')).filter((name) => name.endsWith('.test.ts')).sort();
  if (testFiles.length === 0) throw new Error('No test files found in tests/');
  await build({
    stdin: {
      contents: testFiles.map((name) => `import ${JSON.stringify(`./tests/${name}`)};`).join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    mainFields: ['module', 'main'],
    format: 'esm',
    outfile: target,
  });
  await import(pathToFileURL(target).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
