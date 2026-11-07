import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = await mkdtemp(join(tmpdir(), 'plakoto-tests-'));
try {
  const target = join(directory, 'tests.mjs');
  await build({
    entryPoints: ['tests/game.test.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: target,
  });
  await import(pathToFileURL(target).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
