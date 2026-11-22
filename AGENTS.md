# Agent guidelines

## Project intent

Tavli is a two-player Plakoto game with a Classic ruleset and a configurable Powerups variant. Treat Classic as the baseline and record every variant rule explicitly before changing it.

Read [docs/game-spec.md](docs/game-spec.md) for implemented rules, [docs/architecture.md](docs/architecture.md) for the current code map, [docs/code-style.md](docs/code-style.md) for readability and semantic-spacing conventions, [docs/refactor-plan.md](docs/refactor-plan.md) for the staged target structure, and [docs/runtime-robustness-refactor-plan.md](docs/runtime-robustness-refactor-plan.md) for the active authority/presentation hardening work. Keep the current-state documents aligned with behavior changes.

## Where changes belong

- `src/game/rules/position.ts`, `moves.ts`, and `outcome.ts` own pure board rules. `src/game/session/transition.ts` is the pure command → state/events boundary for turn flow and undo; `phase.ts` defines allowed phases, `state.ts` defines the shared state, and `messages.ts` formats status copy. `session/game.ts` is a compatibility facade retained for regression tests; production local and online flows call `transitionSession` directly. `src/game/engine.ts` still re-exports the facade and rule types for older imports. Keep rules and transitions independent of Three.js, the DOM, and WebSockets.
- `src/game/points.ts` maps logical movement to physical point IDs. A visual layout change must not alter these paths.
- `src/net/lobby.ts` runs the authoritative online session for players connected to this process. `server/tables.ts` and `server/store.ts` share the queue and live matches through MongoDB. `src/net/messages.ts` defines the wire protocol. Validate new commands on the server before applying them.
- `src/app/local-authority.ts` owns the local `Session`, transition calls, history, and injected randomness; `session/messages.ts` projects semantic events or stable state into presentation copy. `interaction-controller.ts` owns transient operation, ability-selection, legal-move cache, and held-checker state without advancing authority. `game-controller.ts` is the compatibility facade that routes interaction decisions to local or online authority and adopts authoritative updates immediately. `online-authority-client.ts` owns the online seat, command identity, pending acknowledgement, and command transport port. `pickup-selection.ts` owns the temporary held-checker queue and revalidates it after accepted moves. `presentation-coordinator.ts` owns presentation-only blocking and stale-completion protection. `gameplay-actions.ts` sequences accepted local commands with scene and dice presentation; `online-game-flow.ts` adopts server updates before starting presentation; `match-session.ts` coordinates search, pairing, table exit, and disconnect with a discriminated lifecycle state through transport and UI ports. `src/scene/checkers.ts` coordinates board input and scene presentation; `src/ui/gameplay-hud.ts` presents turn controls, player panels, and held-checker choices. `src/scene/board-input.ts` owns pointer picking and hover previews and emits selection intents; the controller applies queue changes. `src/scene/board-presentation.ts` maps board state to checker positions; `src/scene/move-animation.ts` owns move and pin presentation; `src/scene/dice.ts` handles the visible dice. `src/main.ts` creates and wires these pieces.
- `src/ui` and the CSS files own menus, preferences, and responsive presentation. `src/ui/shell.ts` composes the chrome and forwards navigation calls; `title-screen.ts` owns the start menu, ruleset choice, matchmaking state, and private-room panel; `overlay.ts` owns the shared dialog mechanics; `settings-dialog.ts`, `help-dialog.ts`, `history-list.ts`, `playtest-tools.ts`, and `playtest-analysis-panel.ts` own their panels. `src/tokens.css` holds the shared palette and radius tokens, `src/style.css` holds shared table styling, `src/dialog.css` holds the overlay dialog, `src/settings.css` holds the Settings-panel sections, `src/auth.css` holds the sign-in screen, `src/gameplay-hud.css` holds in-game state and turn controls, `src/title.css` holds the start screen, `src/responsive.css` adapts layout, and `src/waiting.css` holds matchmaking.

## Rules and state invariants

- There are 30 unique checker IDs: 0–14 belong to player 0 and 15–29 to player 1. Every ID must remain in exactly one board stack or its owner's `off` tray.
- A board stack is ordered bottom to top. Its top checker controls the point. A lone enemy checker can be pinned beneath a landing checker; the pinned checker stays on the board.
- `legalMoves` enforces maximum usable dice and the higher die rule. Combined moves must validate each intermediate landing and use the same checker throughout.
- Online clients send intentions; the server rolls dice, checks moves, updates state, and broadcasts results. Rendered dice and animations are presentations of the authoritative state.
- Automatic opening randomness is sampled through `src/game/session/opening-authority.ts`: every
  attempt contains one owned die per player, tied attempts precede exactly one winning attempt, and
  the complete attempt list is applied by one `resolveOpening` transition.
- `Outcome.points` describes the result of one game. There is no accumulated match score.

## Architecture guardrails

- Authoritative state advances only through a deterministic session transition. Browser timers,
  animation callbacks, HUD handlers, and scene code must never advance game rules.
- Online clients send intentions. The server owns automatic actions, randomness, command
  validation, revisions, clocks, and persistence. Every visible random result must be carried in
  authoritative state, semantic events, or a revision-tied presentation payload.
- Adopt newer authoritative state before presenting it. Presentation may temporarily block input,
  but it must not delay, mutate, or complete authoritative state. Every presentation path needs an
  idempotent completion and cancellation path.
- Keep authoritative state, transient interaction state, connection lifecycle, and presentation
  state separate. Do not add another boolean when a concern already has a phase or discriminated
  state machine.
- Prefer discriminated unions over combinations of optional fields. Invalid phase, update, command,
  and presentation combinations should be unrepresentable or rejected at their trust boundary.
- Online updates must be attributable to a match and monotonic revision. New code must tolerate
  duplicates, stale messages, reconnect snapshots, and late callbacks from a previous revision.
- Server operations that can mutate one match must run through its per-match mutation queue and
  re-read guarded persistence inside that queue. Persist clock and lifecycle changes before
  broadcasting their revision.
- `src/game/session/invariants.ts` is the shared semantic state contract. Extend it and its tests when
  adding authoritative state. Persistence and network decoders perform structural validation before
  applying semantic invariants.
- Keep the current wire protocol strict. Initial match snapshots, updates, semantic events, rules
  snapshots, and stored sessions must pass their complete nested decoder before adoption.
- UI and scene adapters render projections and emit intentions; they do not import or call
  `transitionSession`. Transport code carries typed facts and does not decide game rules.
- Do not create a generic plugin framework for a single mechanic. Give a concrete feature owned
  state, commands/system actions, events, invariants, authority inputs, and presentation projection;
  extract a shared capability only when multiple features need it.

## Change workflow

1. Trace a feature through the pure engine, local UI, online protocol/server, and user-facing help before editing. A new mechanic may affect all four.
2. Add focused tests for changed game rules, session transitions, application routing, and multiplayer validation in `tests/*.test.ts`. The runner `scripts/test.mjs` discovers those files automatically. Extend the `fast-check` reachable-session properties when a rule changes checker conservation, determinism, undo, dice, or phase progression; generate commands from valid states instead of constructing unconstrained random boards.
3. Run `npm run verify` after code changes; it runs `npm run check` (build, coverage-gated unit tests, type-aware lint, and formatting in parallel — about ten seconds) and then the local browser path, about twenty seconds in total. Use `npm run verify:full` (about seventy seconds) when the protocol, server, or online flow changes, or `npm test`, `npm run test:coverage`, `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm run test:browser:local`, or `npm run test:browser` alone when only one step is relevant. Do not lower coverage thresholds merely to make a change pass; add focused tests or document why the measured scope must change. Both smoke variants require Chrome/Chromium; set `PLAKOTO_CHROME_PATH` if it is outside the common Linux locations. Headless pages render at a quarter of the device resolution so software WebGL does not starve every Playwright action; headed runs keep full resolution and are much slower without a GPU. Use `npm ci` first if dependencies are absent. CI runs `npm run check` on Node 24.11 and 26, runs the browser path on Node 26, and publishes coverage, mutation, dependency, and CodeQL results.
   Type-aware linting uses Oxlint with the `tsrs` backend. Preserve its correctness category and explicit promise rules when changing lint configuration; benchmark and verify rule parity before replacing core quality tooling.
   Use `npm run test:mutation` when pure rules or automatic-opening behavior changes. Keep it outside the normal `check` loop, inspect surviving mutants for missing behavioral assertions, and do not weaken its measured scope or threshold merely to make a run pass. The separate mutation workflow runs automatically when its source, focused tests, configuration, or dependencies change and uploads the HTML report on failure. Use `npm run test:mutation:dry` when only validating runner configuration.
4. Update the game spec when behavior changes and the architecture document when boundaries or data flow change. Keep the README and in-app rules text consistent with both.
5. For every new mechanic, specify authority, trigger timing, eligible targets, duration, stacking,
   undo, reconnect, clock, and presentation-interruption behavior before implementation. Test its
   pure transition, authority path, projection, stale/duplicate update handling, and one user-visible
   path as applicable.
6. Structure functions into visible semantic phases: guards, derivation, effects, and projection.
   Keep related statements together, separate different phases with one blank line, and extract a
   named helper when spacing alone cannot make the flow obvious. Run `npm run format`; it applies
   Prettier and the repository's AST-based readability pass.

For future random mechanics, decide trigger timing, eligible targets, effect duration, stacking, undo behavior, and online randomness before implementation. Keep the server authoritative and make any random outcome visible in game state so both clients can reproduce it.
