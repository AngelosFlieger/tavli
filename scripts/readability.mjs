import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const roots = ['src', 'server', 'tests', 'scripts'];

const rootFiles = ['vite.config.ts', 'stryker.config.mjs'];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) return sourceFiles(path);
      if (entry.isFile() && ['.ts', '.mjs'].includes(extname(entry.name))) return [path];

      return [];
    }),
  );

  return files.flat();
}

function category(statement) {
  if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) return 'import';
  if (
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  )
    return 'declaration';
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return 'terminal';
  if (
    ts.isIfStatement(statement) ||
    ts.isSwitchStatement(statement) ||
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement) ||
    ts.isTryStatement(statement)
  )
    return 'control';

  return 'action';
}

function needsBoundary(previous, current, topLevel) {
  const before = category(previous);
  const after = category(current);

  if (topLevel) return before !== 'import' || after !== 'import';
  if (before === 'declaration' || after === 'declaration') return before !== after;
  if (before === 'terminal' || after === 'terminal') return before !== after;
  if (before === 'control' || after === 'control') return before !== after;

  return false;
}

function hasBlankLine(source, previous, current) {
  return /\r?\n[\t ]*\r?\n/.test(source.slice(previous.getEnd(), current.getStart()));
}

function inspectStatements(sourceFile, source, statements, topLevel, findings) {
  for (let index = 1; index < statements.length; index++) {
    const previous = statements[index - 1];
    const current = statements[index];

    if (!needsBoundary(previous, current, topLevel) || hasBlankLine(source, previous, current))
      continue;

    const line = sourceFile.getLineAndCharacterOfPosition(current.getStart()).line + 1;
    const trailingComments = ts.getTrailingCommentRanges(source, previous.getEnd()) ?? [];
    const offset = trailingComments.at(-1)?.end ?? current.getFullStart();

    findings.push({ offset, line });
  }
}

function inspectNode(sourceFile, source, node, findings) {
  if (ts.isSourceFile(node)) inspectStatements(sourceFile, source, node.statements, true, findings);
  else if (ts.isBlock(node) || ts.isModuleBlock(node))
    inspectStatements(sourceFile, source, node.statements, false, findings);
  else if (ts.isCaseClause(node) || ts.isDefaultClause(node))
    inspectStatements(sourceFile, source, node.statements, false, findings);

  ts.forEachChild(node, (child) => inspectNode(sourceFile, source, child, findings));
}

export function formatReadability(source, path = 'source.ts') {
  const scriptKind = path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];

  inspectNode(sourceFile, source, sourceFile, findings);

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let formatted = source;

  for (const finding of findings.toSorted((left, right) => right.offset - left.offset))
    formatted = `${formatted.slice(0, finding.offset)}${newline}${formatted.slice(finding.offset)}`;

  return { formatted, lines: findings.map((finding) => finding.line) };
}

async function inspect(path, write) {
  const source = await readFile(path, 'utf8');
  const result = formatReadability(source, path);

  if (write && result.lines.length) await writeFile(path, result.formatted);

  return result.lines.map((line) => `${path}:${line}`);
}

async function main() {
  const write = process.argv.includes('--write');
  const nestedFiles = (await Promise.all(roots.map(sourceFiles))).flat();
  const files = [...nestedFiles, ...rootFiles].toSorted((left, right) => left.localeCompare(right));
  const findings = (await Promise.all(files.map((path) => inspect(path, write)))).flat();

  if (write) {
    console.log(`Readability formatting updated ${findings.length} logic boundaries.`);
  } else if (findings.length) {
    console.error('Missing a blank line at these logic boundaries:');
    console.error(findings.join('\n'));
    console.error('Run `pnpm format` to repair them.');
    process.exitCode = 1;
  } else {
    console.log('Readability formatting is consistent.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
