# Runtime robustness and feature-isolation refactor

## Goal

Make new gameplay and presentation features additive: a feature should extend a typed domain
contract and its own presentation projector without changing unrelated turn, clock, transport, or
animation behavior. The game must remain playable after every stage.

This plan preserves the existing functional rules core and server authority. It hardens the seams
around that core rather than replacing the application with a framework.

## Original failure modes

1. Authoritative online state was held back until dice or checker presentation completed.
   During that interval the server and controller can be in different phases.
2. Persistence revisions were not included in client updates, so clients could not reject stale,
   duplicate, or previous-match messages.
3. Opening state was represented by several independently mutable fields (`phase`, `opening`,
   `openingRolls`, `active`, and `roll`).
4. Presentation metadata was a collection of optional fields whose combinations and precedence were
   implicit.
5. Player clocks are selected from broad phase names instead of an explicit indication that a
   player owes an action.
6. Match lifecycle, controller operations, and animation completion are separate state machines
   without a shared revision or cancellation identity.
7. The main browser smoke path disables clocks and encodes the old manual opening flow.

## Target dependency direction

```text
game rules and feature domains
        ↓
deterministic session transition → semantic events
        ↓
local/server authority → revisioned authoritative update
        ↓
application coordinator → immutable presentation jobs
        ↓
HUD and Three.js adapters
```

Dependencies only point downward in this diagram. In particular:

- `game` never imports application, transport, UI, or scene code;
- UI and scene code never invoke authoritative transitions;
- presentation completion never mutates or advances authoritative game state;
- online randomness and automatic system actions originate on the server;
- localized copy and animation geometry do not live in `GameState`;
- transports carry typed facts and do not infer game rules.

## Target contracts

### Authoritative state

`GameState` contains reproducible gameplay facts only. Transient selection, animation, localized
messages, and connection state live outside it. Phase-specific data becomes discriminated so an
invalid combination is not representable or is rejected at the transition boundary.

### Commands and system actions

Player commands contain an ID and expected match revision. Automatic mechanics use explicit
authority-owned system actions rather than pretending to be player commands. Random outcomes are
sampled by an authority adapter and passed to one atomic deterministic transition.

### Updates

Every online update contains:

- `matchId`;
- monotonically increasing `revision`;
- authoritative state and undo availability;
- semantic events;
- a discriminated list of presentation jobs.

Clients adopt a newer state immediately, acknowledge the matching command operation, and then
enqueue its presentation. Duplicate or older revisions are ignored. A new match ID cancels all
presentation and interaction state from the previous match.

### Presentation

Presentation jobs describe facts such as dice ownership, value, origin, and whether jobs run
together. They never own game progression. Every job has an identity, revision, blocking policy,
and cancellation path; completion is idempotent.

### Clocks

Clock policy is derived from explicit player responsibility, not from whether a visual is playing.
System-controlled, draft-resolution, setup, and reveal phases do not consume a player's time.

## Stages

### Current progress

- Stage 0 completed: semantic state invariants are shared by transition traces, persistence, and the
  network decoder; malformed or contradictory snapshots are rejected before application adoption.
  Architecture tests prevent UI/scene adapters and the interaction controller from invoking
  authoritative transitions. Regression coverage includes interrupted and superseded presentation,
  stale/duplicate updates, reconnect startup, and an enabled short clock through server authority.
- Stage 1 completed: protocol v3 carries `matchId` and `revision` on matched, resumed, and update
  messages; commands carry a command ID, match ID, and expected revision; results explicitly accept
  or reject the originating command. The server accepts only the current protocol, stale commands
  cannot mutate state, and the online flow ignores older/foreign updates, duplicate results, and
  acknowledgements for a superseded operation.
- Stage 2 completed: online dice and move updates adopt authoritative state immediately.
  `PresentationCoordinator` owns the independent input blocker and ticket identity; resize or newer
  updates cancel presentations safely, and late dice/move callbacks cannot mutate state or release a
  newer blocker. Optional wire hints were replaced by validated `DICE`, `MOVE`, and `RESET_DICE`
  jobs tied to the update cursor. The current policy allows at most one job per revision rather than
  silently ignoring extras. Stored legacy hints migrate on read, and older clients receive an
  explicit incompatibility response. The grouped opening reveal is one atomic, revision-bound
  `OPENING` job.
- Stage 3 completed: `OnlineAuthorityClient` now owns the online seat, command ID sequence, pending
  command identity, acknowledgement, and send port behind a small injectable interface.
  `LocalAuthority` owns the local session, randomness, deterministic transition calls, messages, and
  history. `InteractionController` owns transient operation, ability selection, legal-move caching,
  and held-checker state without importing the session transition. `GameController` retains its
  compatibility API without owning either authority implementation or transient interaction state.
  `MatchSession` now represents lifecycle as `IDLE | SEARCHING | PLAYING`, with the authority cursor
  present only in `PLAYING`, so invalid boolean combinations cannot erase a live match cursor.
- Stage 4 completed: `resolveAutomaticOpening` samples one die per player in
  atomic paired attempts, rerolls both on ties, and submits the complete attempt history through one
  deterministic `resolveOpening` transition. The resulting winner, final owned dice, and all visible
  tie attempts are recorded in authoritative state. Local and online authorities resolve it without
  input, then project one grouped player-colored dice job and a board announcement after setup. State
  advances to `WAITING_FOR_ROLL` before presentation, the normal winner's clock starts without an
  opening clock, and missing or interrupted renderers cannot retain an input lock. `OpeningState` is
  now one `PENDING | RESOLVED` union containing the attempt history and winner; the manual opening
  transition and parallel writable fields are gone. The persistence boundary alone migrates legacy
  snapshots, including the old `OPENING_ROLL` phase name.

- Stage 4 trust-boundary cleanup completed: HUD, local controller, and online lobby accept movement
  rolls only from `WAITING_FOR_ROLL`; a player command cannot advance `OPENING`. When an older
  stored live match still contains a pending manual opening, `server/tables.ts` resolves it through
  the same automatic authority helper, persists a monotonic revision with one `OPENING` job, and
  resumes both clients from the resolved state.
- Stage 5 completed: localized status text and keys are no longer fields in `GameState`, persisted
  history, or network snapshots. `session/messages.ts` is a pure event/state-to-copy projector, and
  the HUD derives reconnect-stable game-over copy from the authoritative outcome. The store removes
  legacy message fields while decoding older snapshots.
- Stage 6 completed: `AGENTS.md` records the required ownership map, authority/presentation
  guardrails, mechanic-design checklist, documentation duties, and verification gates. Architecture
  tests enforce the dependency direction that can be checked mechanically; feature-specific
  transition, trust-boundary, interruption, and browser tests remain required by the workflow.
- Stage 7 completed: per-match mutation queues serialize commands, cancellation, reconnect, and
  disconnect within the authority process; timeout and stale-disconnect claims re-read state under
  the same lock. Disconnect clock pauses are persisted with elapsed time deducted. Network and
  persistence decoding share the complete nested state validator, initial rules snapshots and
  semantic event payloads are validated, and updates cannot re-enter a match after its lifecycle
  has left `PLAYING`. Match insertion removes seat claims if document creation fails.

### Stage 0 — Safety net and executable boundaries

1. Add a pure session-state invariant checker with focused tests for board conservation,
   phase-specific fields, outcomes, ruleset/config consistency, and clock responsibility.
2. Run it over representative transition traces and stored-session fixtures.
3. Expand architecture tests to enforce dependency direction for game, transport, UI, and scene
   layers.
4. Add regression tests for late callbacks, duplicate updates, a newer update arriving during an
   animation, reconnect, and enabled-clock startup.

**Exit:** current behavior is unchanged; invalid state combinations and dependency violations fail
focused tests.

### Stage 1 — Revisioned authority contract

1. Add `matchId` and `revision` to matched, resumed, and update messages.
2. Add command IDs and expected revisions to gameplay commands.
3. Make the server return typed accepted/rejected results tied to command IDs.
4. Track the latest adopted match/revision on the client and ignore stale or duplicate updates.
5. Keep a compatibility decoder for the immediately previous protocol while deployed clients may
   still exist; bump the negotiated protocol with compatibility tests.

**Exit:** reordered, duplicated, and previous-match packets cannot change client state or release a
newer interaction lock.

### Stage 2 — State adoption independent of presentation

1. Replace pending authoritative roll/move state with immediate adoption.
2. Introduce `PresentationJob` as a discriminated union and replace optional update hints.
3. Add a `PresentationCoordinator` responsible for the current blocking job, interruption, and
   idempotent completion. Reject unsupported multi-job updates until a concrete grouped feature
   defines its ordering policy; reduced-motion remains a renderer concern.
4. Derive input blocking from authoritative eligibility plus the coordinator's explicit blocking
   job, never from stale game state.

**Exit:** authoritative state remains current while dice and checker animations run; interruption
or missing animation callbacks cannot stall the game.

### Stage 3 — Separate application responsibilities

Split the current controller responsibilities behind small interfaces:

- `LocalAuthority`: local randomness and deterministic transitions;
- `OnlineAuthorityClient`: revisioned commands and update adoption;
- `InteractionController`: player intentions, selection, and eligibility;
- `PresentationCoordinator`: visual job lifecycle;
- `MatchLifecycle`: title/search/loading/playing/reconnecting/leaving state.

Migrate one caller at a time and retain temporary facades until parity tests pass.

**Exit:** adding a domain feature does not require editing connection lifecycle or generic animation
completion code.

### Stage 4 — Explicit opening feature

1. Replace the opening boolean and parallel fields with a discriminated opening model or explicit
   opening phases.
2. Add a server-owned readiness handshake for both seats.
3. Resolve each opening attempt atomically: sample one owned die per player together, retry both on
   a tie, and record every visible result.
4. Project opening events into grouped player-colored dice jobs and HUD announcement jobs.
5. Enter the normal `WAITING_FOR_ROLL` state independently of presentation; start the normal player
   clock only according to explicit clock policy.

**Exit:** local and online opening require no roll click, use exactly one die per player, survive
ties/reconnect/interruption, and enable the winner's normal roll without an opening timer.

### Stage 5 — Remove presentation data from game state

1. Derive status keys and parameters through a HUD projection.
2. Migrate `message`, `messageKey`, and `messageParams` out of authoritative game state and persisted
   history.
3. Give each feature an event-to-projection module; renderers consume projections rather than
   branching on rules phases or ability IDs.

**Exit:** changing copy, language, layout, or animation cannot alter deterministic state, undo, or
persistence.

### Stage 6 — Feature extension template

Document and enforce the workflow for every mechanic:

1. specify trigger, authority, eligible targets, duration, stacking, undo, reconnect, and clock
   behavior;
2. add feature-owned state, commands/system actions, transition, events, and invariants;
3. add authority randomness only through injected inputs;
4. add event projection and presentation adapters;
5. test pure transition, authority, projection, coordinator interruption, online parity, and one
   browser path.

Avoid a generic plugin framework. Introduce shared capability interfaces only after two concrete
features require the same extension point.

## Verification gates

Each stage must pass:

- focused unit and contract tests for the changed boundary;
- `npm run check`;
- `npm run test:browser:local` for local-only changes;
- `npm run verify:full` for protocol, server, clock, reconnect, or online-flow changes;
- updated `game-spec.md` for behavior changes and `architecture.md` for ownership changes.

At least one online integration test must use an enabled short clock. The long software-rendered
browser smoke may remain clockless, but it cannot be the only lifecycle test.

## Refactor rules

1. Structural stages preserve behavior unless the stage explicitly names a behavior change.
2. Old and new paths coexist only behind a tested compatibility facade and for one migration stage.
3. No authoritative decision is scheduled with a browser timer or animation callback.
4. No presentation job may contain a callback that directly changes session state.
5. State and update invariants are checked at trust boundaries: transition tests, persistence read,
   and network decode.
6. A stage is not complete while its legacy source of truth remains writable.
