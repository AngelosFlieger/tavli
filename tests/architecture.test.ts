import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pureRoots = ['src/game/rules', 'src/game/session', 'src/game/variant'];

const forbiddenImport =
  /from\s+['"](?:three|ws|mongodb|@capacitor\/[^'"]+|(?:\.\.\/)+(?:scene|ui|net|app|server)\/[^'"]*)['"]/;

const authoritativeTransitionImport = /from\s+['"][^'"]*game\/session\/transition['"]/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) return sourceFiles(path);

      return entry.name.endsWith('.ts') ? [path] : [];
    }),
  );

  return files.flat().sort();
}

test('pure rules and session layers do not import presentation or transport code', async () => {
  for (const root of pureRoots) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, 'utf8');

      assert.doesNotMatch(source, forbiddenImport, `${file} crosses a pure-layer boundary`);
    }
  }
});

test('UI and scene adapters cannot invoke authoritative session transitions', async () => {
  for (const root of ['src/ui', 'src/scene']) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, 'utf8');

      assert.doesNotMatch(
        source,
        authoritativeTransitionImport,
        `${file} bypasses the application boundary`,
      );
    }
  }
});

test('the interaction controller delegates session transitions to local authority', async () => {
  const source = await readFile('src/app/game-controller.ts', 'utf8');

  assert.doesNotMatch(source, /\btransitionSession\s*\(/);
  assert.doesNotMatch(source, /\binitialPresentedSession\s*\(/);
  assert.doesNotMatch(source, /new PickupSelection\s*\(/);

  const interaction = await readFile('src/app/interaction-controller.ts', 'utf8');

  assert.doesNotMatch(interaction, authoritativeTransitionImport);
});

test('the repository uses the pinned pnpm toolchain exclusively', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    packageManager?: string;
    scripts?: Record<string, string>;
  };

  assert.equal(manifest.packageManager, 'pnpm@11.29.0');
  assert.ok(manifest.scripts);

  for (const [name, command] of Object.entries(manifest.scripts)) {
    assert.doesNotMatch(command, /\bnpm(?:\s+run)?\b/, `${name} bypasses the pnpm toolchain`);
  }

  const lockfile = await readFile('pnpm-lock.yaml', 'utf8');

  assert.match(lockfile, /^lockfileVersion: '9\.0'/);
  await assert.rejects(readFile('package-lock.json', 'utf8'), { code: 'ENOENT' });
});
