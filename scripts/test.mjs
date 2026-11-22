import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const coverage = process.argv.includes('--coverage');
const mongo = await MongoMemoryServer.create();
process.env.PLAKOTO_MONGO_URL = mongo.getUri();
try {
  const testFiles = (await readdir('tests')).filter((name) => name.endsWith('.test.ts')).sort();
  if (testFiles.length === 0) throw new Error('No test files found in tests/');
  const code = await new Promise((resolve) => {
    const nodeArgs = [
      '--import=tsx',
      '--test-isolation=none',
      ...(coverage
        ? [
            '--experimental-test-coverage',
            '--test-coverage-include=src/**/*.ts',
            '--test-coverage-include=server/**/*.ts',
            '--test-coverage-lines=89',
            '--test-coverage-branches=79',
            '--test-coverage-functions=87',
          ]
        : []),
      '--test',
      ...testFiles.map((name) => join('tests', name)),
    ];
    spawn(process.execPath, nodeArgs, {
      stdio: 'inherit',
      env: { ...process.env, PLAKOTO_MONGO_URL: mongo.getUri() },
    }).on('exit', resolve);
  });
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  await mongo.stop();
}
