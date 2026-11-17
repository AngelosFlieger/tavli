# Variant implementation improvement plan

This document records the next structural improvements for the configurable powerup and passive
system. The current implementation remains the behavioral baseline. Refactors must preserve Classic
rules, public variant state, server-owned randomness, undo behavior, and the existing local/online
presentation sequence.

## Goals

- Keep an in-progress match reproducible even after registered balance profiles change.
- Deliver the same authoritative action metadata to both players when they are connected to
  different server processes.
- Make adding an ability require one cohesive behavior module instead of edits across unrelated
  switches.
- Reduce invalid application workflow states and repeated local/online routing.
- Split the draft modal, loadout cards, and active-effect presentation into reusable UI units.
- Remove duplicated logic and unused protocol fields as each boundary is migrated.

## Stage 1: persistent match context and revision envelopes

Status: **complete**.

Persist the resolved variant configuration with every match. The stored snapshot, rather than the
currently registered profile with a matching hash, becomes the authority for restore, reconnect,
and rematch. Classic matches store a null configuration.

Persist the metadata for the most recently accepted game revision separately from the session:

- semantic session events;
- physical dice values and the single rerolled-die index;
- accepted move sequence;
- dice reset and any remaining presentation hints.

The stored session remains the only authoritative state. The revision envelope does not duplicate
`state` or `canUndo`; a receiving process combines its metadata with the stored session. An envelope
is replayed only when the receiver is exactly one revision behind. Larger gaps adopt the complete
state without trying to animate an action from an unknown intermediate position.

Legacy matches without a configuration snapshot continue to resolve through the registered-profile
hash fallback. Their next accepted action writes the resolved snapshot.

Verification:

- storage round-trip for an unregistered but valid configuration snapshot;
- two-process roll delivery preserves dice and events;
- two-process move delivery preserves the exact sequence and events;
- reconnect, away revisions, game completion, and rematch retain their existing behavior.

## Stage 2: ability behavior capabilities

Status: **complete**. End-turn behavior capabilities are implemented for Frost Seal, Bastion, and
Jinx; the before-roll capability is implemented for Clear Skies; after-roll capabilities are
implemented for Recast, Nudge, and Opportunist; and all four passives own their roll, movement,
capacity, counter, and lifecycle policies.

Keep concrete powerup and passive folders separate. Each ability module should export its validated
definition plus the rule capabilities it implements. Capability groups should follow timing and
responsibility rather than form one universal handler:

- before-roll target discovery and activation;
- after-roll options, authority randomness requirements, and activation;
- end-turn targets, effect construction, and effect validity;
- passive roll, movement, capacity, counter, and lifecycle policies.

Aggregate these modules in typed registries. Add contract tests that ensure every enabled ability
has the capabilities required by its kind and timing. Keep DOM and Three.js presentation out of the
rules registry; use a separate UI presenter registry keyed by the same ability ID.

Migrate one timing group at a time while keeping `transitionSession` as the single public
command-to-state/events boundary.

The passive registry composes additive and replacement inventory rules deterministically. A
replacement capacity suppresses additive bonuses; if future passives provide multiple replacement
values, the most restrictive value wins. `passives/policy.ts` remains a compatibility facade while
concrete behavior lives beside each passive definition.

## Stage 3: controller workflow state

Status: **complete**.

Replace the independent roll, move, draft, end-turn, ability, and remote-animation booleans with one
discriminated pending-operation state. Keep ability targeting as a separate selection state. Extract
the common local/online command routing behind a small authority boundary where that removes real
duplication without hiding presentation-specific results.

The migration must retain epoch-based rejection of stale animation callbacks and pickup queue
revalidation.

`GameController` now has one discriminated operation state for roll, move, draft-pick, end-turn,
ability, and remote-move work. Forced local dice and the pending remote move result live inside the
relevant operation variants. Ability targeting remains independent, and one online authority helper
atomically records the operation before sending each command. Completion methods only release the
matching operation, so a late animation callback cannot unlock newer work.

## Stage 4: ability UI decomposition

Status: **complete**.

Split `draft-panel.ts` by UI ownership:

- draft dialog and order reveal;
- reusable ability-card content;
- overlapping loadout stack;
- focused ability details and Use action;
- active-effect list.

Move ability-specific option labels and counter text into a UI presenter registry. The controller
continues to return authoritative legal targets/options; presenters only format those options.

`draft-panel.ts` is now a thin composition boundary over modules in `src/ui/abilities`: the modal
draft/order flow, shared card content, overlapping loadout stacks, focused details and Use action,
and active-effect list. A complete presenter registry keyed by ability ID owns passive counter copy,
roll-selection prompts, option labels, and direct-die presentation hints without deciding legality.

## Stage 5: focused cleanup

Status: complete.

- Move rules-context resolution to a shared variant boundary used by local setup, matchmaking,
  restore, and online join validation.
- Share the Nudge and Opportunist die-adjustment implementation.
- Remove the duplicated local `receiveRoll` dispatch.
- Remove `draftRolls` from the protocol if it remains unused after revision-envelope work.
- Extract accessible die-selection overlays from the 3D dice toss implementation when dice work next
  changes.

`rules-context.ts` now resolves selections, exact snapshots, legacy state hashes, queue identities,
and state/snapshot agreement for all local and online callers. The earlier behavior-registry work
shares Nudge and Opportunist adjustment logic, and the controller's discriminated operation state
keeps local roll completion to one dispatch. Draft order attempts remain in public draft state, so
the redundant `draftRolls` update field and revision-envelope copy were removed. Accessible die
buttons and their screen projection now live in `die-selection-overlay.ts`; `dice.ts` owns only the
3D rings and toss presentation.

## Stage 6: ability extension seam

Status: **complete**.

Each definition module now owns its config type, validation, copy references, and the behavior its
kind and timing require. `abilities/catalog.ts` is the single registry; `AbilityId`, the config
map, metadata, and all capability maps are derived from it. `defineAbility` overloads make a
missing capability a compile error instead of a runtime contract test, the UI renders copy from
definition descriptors, and English copy no longer lives in the rules layer. Public effects now
publish serializable constraints that the move and delayed-roll policies interpret, so those
consumers no longer switch on ability IDs.

Verification: frozen ID order, profile hashes, and seeded draft offers; a runtime import-cycle test;
the full unit suite and both browser paths.

## Completion requirements

Each stage requires focused rule/session/application/multiplayer tests as appropriate, followed by:

```sh
npm test
npm run build
npm run format:check
```

Run `npm run test:browser` for controller or presentation changes. Update the game specification and
architecture map whenever externally visible behavior or ownership boundaries change.
