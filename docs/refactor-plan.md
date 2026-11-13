# Refactor plan for baseline Plakoto and future variants

## Why this work is needed

The rules are mostly pure and the online server already validates moves, but several boundaries are blurred:

- `src/scene/checkers.ts` grew into the input controller, local turn coordinator, online state reconciler, board layout, HUD updater, and animation owner. Input, animation, layout, HUD presentation, online sequencing, and local command sequencing have since been extracted; it still composes board input and scene presentation.
- `src/game/session/game.ts` remains a compatibility facade for regression tests. Local browser play and the server now use the pure command/event contract directly.
- `src/main.ts` wires scene, dice, UI, network, and animation timing. Application flows now own local and online command sequencing and matchmaking callbacks; the composition entry point still owns startup, render timing, and DOM status handling.
- `src/style.css` and `src/responsive.css` still mix some unrelated styling. Title and matchmaking styles now have separate files. The browser test suite has strong rule coverage but little interaction coverage.

The goal is **clear ownership and stable contracts**, not a framework rewrite. Baseline Plakoto must remain playable throughout the migration.

## Architectural approach

Use **Functional Core, Imperative Shell**, arranged with **Ports and Adapters (Hexagonal Architecture)**. The game and session modules are the functional core: given the current state and a command, they produce a new state and semantic events or a rejection. The browser, Three.js scene, WebSocket transport, and server-side random source are adapters around that core. `main.ts` composes them; it does not decide game rules.

The session uses an explicit turn state machine with opening roll, waiting for roll, waiting for move, turn complete, and game over phases. A command is accepted only in a valid phase and for the active player. Dice and checker presentation waits live in the application controller, outside shared game state.

The core returns events such as `CheckerMoved`, `CheckerPinned`, `TurnEnded`, and `GameEnded` alongside authoritative state. Adapters use those events for animation, sound, and messages; events do not replace state or require an event bus or event-sourcing store. Online commands are authorized by the server, which supplies dice and future random outcomes as explicit inputs and broadcasts the resolved state and relevant events. Local play uses the same transition logic with a browser-side random adapter.

This is a small set of boundaries, not a mandate to add a framework, ECS, full CQRS, or event sourcing. Add a ruleset seam only when the first variant mechanic has a defined trigger and effect.

## Target boundaries

| Layer              | Owns                                                                                              | Must not depend on                            |
| ------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `game/rules`       | Position changes, legal moves, pinning, bearing off, outcomes                                     | DOM, Three.js, WebSocket, random global state |
| `game/session`     | Turn phases, command validation, undo, deterministic state transitions                            | Rendering and transport                       |
| `app`              | Local or online command routing, pending action/animation coordination, transient pickup queue    | Three.js internals and server implementation  |
| `scene`            | Board geometry, picking, checker visuals, dice, previews, animations                              | Mutating authoritative state                  |
| `ui`               | Menus, HUD, help, preferences, accessible controls                                                | Game rule decisions                           |
| `net` and `server` | Protocol, matchmaking, server-owned dice/random decisions, command authorization, state broadcast | Client visual state                           |

The intended flow for new mechanics is `command → validated transition → state + semantic events → transport → presentation`. The scene chooses how to animate the events. A future random outcome is chosen by the authoritative random adapter, then recorded in state or the event payload so both clients see the same result.

Do not add a generic plugin or effect registry before the first variant mechanic is specified. Define its timing, stacking, undo, and online behavior first, then add the smallest ruleset seam that supports it.

## Migration stages

### 1. Split scene responsibilities

**Extraction completed:** `src/scene/move-animation.ts` owns move interpolation, pin impact presentation, cancellation, and animation-stage preparation. `board-presentation.ts` owns checker spots, tray coordinates, pinned stack height, and the opening deal. `board-input.ts` owns raycast picking and emits `pickUp`, `place`, `releaseLast`, and `clear` intents. The temporary pickup queue moved to `src/app/pickup-selection.ts` during stage 3, and the controller now applies selection intents. `checkers.ts` retains the `createGameplay` public API and presents accepted moves through callbacks from the application layer.

The input module does not know how the camera zooms during a pin, and the animation module does not decide whether a move is legal. Browser checks confirmed ordered two-checker placement locally and across two online clients, plus local Undo. A later check confirmed the title and game layouts at desktop and portrait sizes and a portrait-to-desktop resize. Pin impact and the system reduced-motion presentation still need visual checks.

**Checkpoint:** local and online moves, multi-checker pickup, undo, pin impact, resize, and reduced-motion behavior match the baseline.

### 2. Separate rules from session flow

**Rules extraction completed:** `src/game/rules/position.ts`, `moves.ts`, and `outcome.ts` now own board operations, move search, and results. `src/game/session/phase.ts` centralizes allowed phase transitions, and `session/game.ts` owns the unchanged `Game` flow. `engine.ts` re-exports the existing API for callers. The temporary pickup queue imports the pure rules directly, without depending on the session.

**Session transition completed:** `src/game/session/transition.ts` now accepts typed roll, move, undo, end-turn, and restart commands, returning a new session and semantic events or a rejection. It leaves input state and history unchanged. `session/state.ts` defines the shared state, `session/messages.ts` formats status text from events, and `session/game.ts` retains the old `Game` API for regression tests; the browser controller and server now apply `transitionSession` directly. Direct tests cover phase and dice rejection, immutable inputs, fresh pin events, out-of-range move rejection, facade/transition state parity, server parity through a full turn, local controller parity including messages and Undo, and atomic rejection of invalid server dice. Moves now resolve to their final authoritative phase in one transition; presentation waits are controller state.

The transition must continue enforcing maximum dice use, the higher die rule, intermediate landings, pins, mother wins, and bear-off constraints. Preserve stable checker IDs and the existing board representation during this stage.

**Checkpoint:** the same deterministic rule tests pass against the extracted modules, and the facade and transition return equivalent states for a representative full game.

### 3. Add an application controller

**Routing extraction completed:** `src/app/game-controller.ts` owns the local session, local versus online command routing, online pending roll and move results, input wait flags, remote adoption, active seat checks, and mutations to the held-checker queue. `src/app/gameplay-actions.ts` sequences accepted user commands with local scene and dice presentation, including animation completion, Undo, restart, and roll controls. `src/app/online-game-flow.ts` sequences incoming server updates, animation completion, adoption, joining, and leaving through scene and dice interfaces. `src/app/match-session.ts` coordinates search, cancellation, pairing, and disconnect through transport and UI ports. `main.ts` composes these with `checkers.ts`, which owns board input and Three.js presentation. `src/ui/gameplay-hud.ts` owns turn controls, held-checker choices, status text, and player panels. Direct tests cover local move/undo, online wait/adoption and sequencing, the queue across sequential placements and server updates, and local animation interruption with an ignored late callback, and match lifecycle handling. Presentation waits are removed from authoritative phases. Browser checks covered local pickup, release, placement, undo, restart, two-seat online roll, placement and undo, search cancellation, portrait-to-desktop resize, and local start after online play. The remaining verification is a complete local and online game, plus pin impact and system reduced-motion checks.

Pending rolls, move animation completion, local versus online routing, and remote state adoption now sit behind one application-level interface. `main.ts` should compose services; `checkers.ts` should emit user intents and render state. The pickup queue stays transient and is revalidated after each accepted authoritative move. The server remains the only online authority; it must re-check every command.

Keep the existing wire messages while moving code. When a variant needs new messages, add an explicit protocol version or capability field rather than guessing from missing properties.

**Checkpoint:** one local game and a two-browser online game complete; rejected or out-of-turn commands cannot change either board; undo and disconnect/leave behavior remain defined.

### 4. Prepare the variant seam

After a concrete random event or ability is specified, add a ruleset identifier to shared state and an effect resolver with injected randomness. Resolve effects only in the core transition on the server for online play. Store enough outcome data for replay, undo, and consistent animation on both clients. Keep baseline Plakoto as a distinct selectable ruleset and run its current tests unchanged.

**Checkpoint:** a deterministic variant test demonstrates the full command/state/event path without putting mechanic logic in the scene or HUD.

### 5. Tighten presentation and verification

Group CSS by screen or component while preserving selectors and responsive layout. The start screen has moved to `src/title.css`, matchmaking to `src/waiting.css`, and gameplay status and turn controls to `src/gameplay-hud.css`. The unit runner discovers `tests/*.test.ts` automatically. `npm run test:browser` now checks the local title-to-table flow, opening and movement rolls, checker pickup and placement, Undo, reduced-motion timing, two-seat matchmaking and authoritative dice synchronization, and browser errors in isolated Vite, game-server, and Chrome sessions. Manual browser checks confirmed the desktop and portrait title layouts, the portrait board, a resize back to desktop, and the in-game motion switch. Extend the browser suite with pin preview; keep visual checks focused on effects that automated state checks cannot verify. System reduced-motion presentation still needs visual inspection.

**Checkpoint:** `npm test`, `npm run build`, and `npm run format:check` pass, plus local and online smoke checks at desktop and portrait sizes.

## Working rules for each stage

1. Move one responsibility at a time and keep its old public call shape until callers are migrated.
2. Do not combine a behavior change with a structural move unless a focused test exposes an existing bug.
3. Keep `game` importable by Node without browser globals. Keep randomness injectable and server-owned for online matches.
4. Update `docs/game-spec.md` for behavior changes and `docs/architecture.md` when ownership changes.
5. Avoid broad snapshots for 3D output; test rules with focused cases and visually inspect interaction/animation checkpoints.
