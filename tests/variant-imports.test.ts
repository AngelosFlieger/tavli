import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

/**
 * The variant layer is loaded by both the browser and the authoritative server. A runtime import
 * cycle risks module-init order bugs that type-only imports would hide, so keep the graph acyclic.
 */
const root = 'src/game/variant';

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

/** Static runtime imports and re-exports; `import type` never reaches the module graph. */
function runtimeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const clause = match[1].trim();
    if (clause.startsWith('type ')) continue;
    const named = clause.match(/\{([\s\S]*)\}/);
    if (
      named &&
      named[1]
        .split(',')
        .map((part) => part.trim())
        .every((part) => !part || part.startsWith('type '))
    )
      continue;
    specifiers.push(match[2]);
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specifiers.push(match[1]);
  return specifiers;
}

function findCycle(graph: Map<string, string[]>): string[] | null {
  const status = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string): string[] | null => {
    const state = status.get(node) ?? 0;
    if (state === 1) return [...stack.slice(stack.indexOf(node)), node];
    if (state === 2) return null;
    status.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    status.set(node, 2);
    return null;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

test('the variant layer has no runtime import cycles', async () => {
  const files = await sourceFiles(root);
  const known = new Set(files.map((file) => normalize(file)));
  const graph = new Map<string, string[]>(files.map((file) => [file, []]));
  for (const file of files) {
    for (const specifier of runtimeSpecifiers(await readFile(file, 'utf8'))) {
      if (!specifier.startsWith('.')) continue;
      let target = normalize(join(dirname(file), specifier));
      if (!target.endsWith('.ts')) target += '.ts';
      if (!known.has(target)) target = normalize(join(target, 'index.ts'));
      if (known.has(target)) graph.get(file)!.push(target);
    }
  }
  const cycle = findCycle(graph);
  assert.equal(cycle, null, cycle ? `runtime import cycle: ${cycle.join(' -> ')}` : '');
});
