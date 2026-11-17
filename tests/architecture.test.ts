import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const pureRoots = ['src/game/rules', 'src/game/session'];
const forbiddenImport =
  /from\s+['"](?:three|ws|mongodb|@capacitor\/[^'"]+|(?:\.\.\/)+(?:scene|ui|net|app|server)\/[^'"]*)['"]/;

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
