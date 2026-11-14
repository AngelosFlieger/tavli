import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.PLAKOTO_MONGO_URL = mongo.getUri();
const directory = join(process.cwd(), 'node_modules', '.cache', 'plakoto-tests');
await mkdir(directory, { recursive: true });
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
    external: ['mongodb'],
    mainFields: ['module', 'main'],
    format: 'esm',
    outfile: target,
  });
  const code = await new Promise((resolve) => {
    spawn(process.execPath, ['--test', target], {
      stdio: 'inherit',
      env: { ...process.env, PLAKOTO_MONGO_URL: mongo.getUri() },
    }).on('exit', resolve);
  });
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  await mongo.stop();
  await rm(directory, { recursive: true, force: true });
}
