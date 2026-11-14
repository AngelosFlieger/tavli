# Agent guidelines

## Project intent

Tavli is currently a two-player Plakoto game. The longer-term goal is a variant with random events, powerups, and abilities. Those systems are **not implemented or specified yet**. Treat the existing rules as the baseline and record any variant rule explicitly before changing it.

Read [docs/game-spec.md](docs/game-spec.md) for implemented rules, [docs/architecture.md](docs/architecture.md) for the current code map, and [docs/refactor-plan.md](docs/refactor-plan.md) for the staged target structure. Keep the current-state documents aligned with behavior changes.

## Where changes belong

- `src/game/rules/position.ts`, `moves.ts`, and `outcome.ts` own pure board rules. `src/game/session/transition.ts` is the pure command → state/events boundary for turn flow and undo; `phase.ts` defines allowed phases, `state.ts` defines the shared state, and `messages.ts` formats status copy. `session/game.ts` is a compatibility facade retained for regression tests; production local and online flows call `transitionSession` directly. `src/game/engine.ts` still re-exports the facade and rule types for older imports. Keep rules and transitions independent of Three.js, the DOM, and WebSockets.
- `src/game/points.ts` maps logical movement to physical point IDs. A visual layout change must not alter these paths.
- `src/net/lobby.ts` runs the authoritative online session for players connected to this process. `server/tables.ts` and `server/store.ts` share the queue and live matches through MongoDB. `src/net/messages.ts` defines the wire protocol. Validate new commands on the server before applying them.
- `src/app/game-controller.ts` routes local and online commands, owns the local `Session`, pending online state and input locks, and adopts authoritative updates. Its `pickup-selection.ts` owns the temporary held-checker queue and revalidates it after accepted moves. `src/app/gameplay-actions.ts` sequences accepted user commands with local scene and dice presentation; `online-game-flow.ts` sequences server updates through scene and dice ports; `match-session.ts` coordinates search, pairing, and disconnect through transport and UI ports. `src/scene/checkers.ts` coordinates board input and scene presentation; `src/ui/gameplay-hud.ts` presents turn controls, player panels, and held-checker choices. `src/scene/board-input.ts` owns pointer picking and hover previews and emits selection intents; the controller applies queue changes. `src/scene/board-presentation.ts` maps board state to checker positions; `src/scene/move-animation.ts` owns move and pin presentation; `src/scene/dice.ts` handles the visible dice. `src/main.ts` creates and wires these pieces.
- `src/ui` and the CSS files own menus, preferences, and responsive presentation. `src/style.css` holds shared table styling, `src/gameplay-hud.css` holds in-game state and turn controls, `src/title.css` holds the start screen, `src/responsive.css` adapts layout, and `src/waiting.css` holds matchmaking.

## Rules and state invariants

- There are 30 unique checker IDs: 0–14 belong to player 0 and 15–29 to player 1. Every ID must remain in exactly one board stack or its owner's `off` tray.
- A board stack is ordered bottom to top. Its top checker controls the point. A lone enemy checker can be pinned beneath a landing checker; the pinned checker stays on the board.
- `legalMoves` enforces maximum usable dice and the higher die rule. Combined moves must validate each intermediate landing and use the same checker throughout.
- Online clients send intentions; the server rolls dice, checks moves, updates state, and broadcasts results. Rendered dice and animations are presentations of the authoritative state.
- `Outcome.points` describes the result of one game. There is no accumulated match score.

## Change workflow

1. Trace a feature through the pure engine, local UI, online protocol/server, and user-facing help before editing. A new mechanic may affect all four.
2. Add focused tests for changed game rules, session transitions, application routing, and multiplayer validation in `tests/*.test.ts`. The runner `scripts/test.mjs` discovers those files automatically.
3. Run `npm test`, `npm run build`, and `npm run format:check` after code changes. Run `npm run test:browser` when browser interaction or presentation changes. Use `npm ci` first if dependencies are absent. The browser smoke test uses an installed Chrome/Chromium executable; set `PLAKOTO_CHROME_PATH` if it is outside the common Linux locations.
4. Update the game spec when behavior changes and the architecture document when boundaries or data flow change. Keep the README and in-app rules text consistent with both.

For future random mechanics, decide trigger timing, eligible targets, effect duration, stacking, undo behavior, and online randomness before implementation. Keep the server authoritative and make any random outcome visible in game state so both clients can reproduce it.
