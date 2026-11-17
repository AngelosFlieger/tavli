import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const tokenFile = 'src/tokens.css';
const definition = /--([\w-]+)\s*:/g;
const reference = /var\(\s*--([\w-]+)\s*\)/g;
/** Palette literals that must stay single-sourced in tokens.css (alpha variants are separate art). */
const paletteLiteral =
  /#(?:0b1427|0c1728|111e33|10192b|f1dfb3|d2c5a9|aeb8c8|d6af72|d9bd84|ead39f|cab17d(?:33|55)?|cb354d|621c32|d34459|bb354e|080e1c|050c1e|060d1e|050d19|f0dfb9|f8e8c0|f8dda2|f1d89e|d6bd85|e9cd91|efd59e)(?![0-9a-f])/i;
const radiusLiteral = /border-radius:\s*(?:(?:6|7|8|9|10|12|14|16)px|999px)/;

async function stylesheets() {
  const files = (await readdir('src')).filter((name) => name.endsWith('.css')).sort();
  return Promise.all(
    files.map(async (name) => ({
      name: `src/${name}`,
      source: await readFile(`src/${name}`, 'utf8'),
    })),
  );
}

async function tokenDefinitions() {
  const source = await readFile(tokenFile, 'utf8');
  return new Set(Array.from(source.matchAll(definition), (match) => match[1]));
}

test('every CSS variable reference resolves to a definition', async () => {
  const sheets = await stylesheets();
  const defined = new Set<string>();
  for (const sheet of sheets) {
    for (const match of sheet.source.matchAll(definition)) defined.add(match[1]);
  }
  for (const sheet of sheets) {
    for (const match of sheet.source.matchAll(reference)) {
      assert.ok(
        defined.has(match[1]),
        `${sheet.name} references undefined custom property --${match[1]}`,
      );
    }
  }
});

test('design tokens stay single-sourced and in use', async () => {
  const tokens = await tokenDefinitions();
  const sheets = await stylesheets();
  const used = new Set<string>();
  for (const sheet of sheets) {
    for (const match of sheet.source.matchAll(reference)) used.add(match[1]);
  }
  assert.deepEqual(
    [...tokens].filter((token) => !used.has(token)),
    [],
    'tokens.css defines tokens nothing uses',
  );

  for (const sheet of sheets) {
    if (sheet.name === tokenFile) continue;
    for (const match of sheet.source.matchAll(definition)) {
      assert.ok(
        !tokens.has(match[1]),
        `${sheet.name} redefines the design token --${match[1]}; change tokens.css instead`,
      );
    }
    const color = sheet.source.match(paletteLiteral);
    assert.equal(
      color,
      null,
      `${sheet.name} spells the palette literal ${color?.[0]} instead of using its token`,
    );
    assert.doesNotMatch(
      sheet.source,
      radiusLiteral,
      `${sheet.name} spells a tokenized radius instead of using its token`,
    );
  }
});
