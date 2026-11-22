# Code readability guidelines

The formatter owns syntax layout; authors own meaning. Use blank lines to make the phases of a
function visible before its individual statements are read.

## File structure

Keep files in this order when the module needs each section:

1. imports;
2. exported types and contracts;
3. module constants and private helpers;
4. the exported API.

Separate top-level declarations with one blank line. Keep imports together, ordered by their
existing module relationship rather than separated by arbitrary blank lines.

## Function structure

Prefer a visible sequence of phases:

1. validate inputs and return from guard clauses;
2. read or derive the values needed by the operation;
3. perform the state change or external action;
4. project the result and return it.

Insert one blank line between those phases. Closely related declarations belong in one declaration
group; unrelated declarations start a new semantic section. Consecutive guard clauses may remain a
group. Consecutive assignments or calls may remain together when they implement one operation.

```ts
function acceptUpdate(update: RevisionedUpdate) {
  if (lifecycle.type !== 'PLAYING') return;
  if (update.matchId !== lifecycle.cursor.matchId) return;

  const nextCursor = { matchId: update.matchId, revision: update.revision };
  const shouldResetDice = update.presentations.some(isDiceReset);

  lifecycle = { type: 'PLAYING', cursor: nextCursor };
  flow.receive(update, shouldResetDice);

  return nextCursor;
}
```

Do not add a blank line after every statement. Whitespace groups one idea; it is not decoration.
When a function still contains many sections, nested branches, or comments that label procedural
steps, extract a named helper or introduce a concrete workflow state instead of adding more spacing.

## Names and comments

- Name values for their domain meaning, not their temporary representation (`cursor`, not `data`).
- Prefer positive predicates and early guards over deeply nested happy paths.
- Comments explain authority, invariants, timing, or a non-obvious reason. Do not narrate syntax.
- Keep rule terms aligned with `docs/game-spec.md` and architecture terms aligned with
  `docs/architecture.md`.

## Enforcement

`pnpm format` runs Prettier and then restores required semantic spacing. `pnpm format:check`
checks both layers. The readability pass enforces stable boundaries between declarations,
control-flow sections, actions, and terminal returns; review still owns boundaries between two
same-shaped action sequences that represent different domain phases.
