# Proposed ability catalog

> **Status:** all recommended initial six powerups and four passives work end to end through the typed registry, shared UI, pure session, public state, movement/passive policies, and online authority. The Powerups ruleset is selectable for local and online play. Names and numbers remain working values for playtests and are intentionally centralized in the balance profile.

The starter pool favors effects that are public, short-lived, deterministic once randomness is resolved, and easy to explain on the board. It intentionally avoids moving enemy checkers, escaping from underneath a pin, direct bearing off, hidden traps, extra turns, and permanent board changes.

The global draft, inventory, timing, target, stacking, and undo rules are in [the implementation plan](powerups-plan.md).

## Configuration map

The numbers below are defaults, not constants inside ability code. Each card has one typed config entry in the selected balance profile. Shared fields on every entry are `enabled` and positive integer `offerWeight`. Card descriptions are generated from the resolved values.

| Ability         | Main configurable parameters                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Frost Seal      | duration boundary/count, home/start targeting, blocks leaving, blocks landing, pinned-stack targeting                           |
| Bastion         | duration boundary/count, home/start targeting, required own checker count, blocks landing                                       |
| Jinx            | expiry boundary/count, token selection, pip penalty/floor, double eligibility/consumption, matching-token handling              |
| Clear Skies     | removable effect tags, maximum effects removed, whether opponent positive effects are targetable                                |
| Recast          | reroll count, required acceptance, allowed roll kinds, whether a created match becomes a double, original-double token handling |
| Nudge           | minimum/maximum adjustment, allowed directions, allowed roll kinds, bearing-off use, whether a created match becomes a double   |
| Flip            | face mapping, allowed roll kinds, bearing-off use, whether a created match becomes a double                                     |
| Ward            | duration/expiry, number of blocked effects, blocked effect tags, whether passive effects are blocked                            |
| Loaded Knuckles | exact match probability, distribution of non-matches, movement tokens for doubles                                               |
| Quartermaster   | extra powerup slots, cooldown turns after use                                                                                   |
| Home Guard      | protected zones, offensive restriction zones, starting-point exclusion                                                          |
| Overdrive       | uses per round, bonus token value/count, exhaustion duration, start/home/bearing-off restrictions                               |
| Opportunist     | trigger, Focus gain/cap/adjustment/directions/uses per roll, allowed rolls, bearing-off use, double creation, equipped capacity |
| Steady Hand     | uses per round, selectable replacement values, natural-double token count                                                       |

Config should expose supported knobs, not arbitrary executable expressions. A new kind of behavior still requires a reviewed ability definition and tests.

## Recommended prototype powerups

### Frost Seal

- **Timing:** `WITH_END_TURN`
- **Target:** one opponent-controlled, unmixed point outside both home boards and both starting points.
- **Effect:** through the end of that opponent’s next turn, the opponent cannot move a checker from the point or land another checker on it.
- **Limits:** cannot target a pinned stack or another Frost Seal. If control changes before the opponent’s turn begins, the seal expires.
- **Default config:** one target turn; home/start and pinned-stack targeting disabled; block both leaving and landing.
- **Why it is balanceable:** it lasts one opposing turn, avoids bearing-off and mother-win points, and has target/duration knobs. It can still cause a no-move turn, so that rate needs close measurement.
- **Temporary presentation:** translucent ice and a snow marker surround the authoritative target stack while the effect remains public.

### Bastion

- **Timing:** `WITH_END_TURN`
- **Target:** one point containing exactly one of the player’s checkers, excluding both starting points.
- **Effect:** the opponent cannot land on that point during their next turn, so the singleton cannot be pinned. The owner may still land more checkers there later.
- **Limits:** expires at the end of the opponent’s turn or immediately if the checker leaves through a future effect.
- **Default config:** one opponent turn; exactly one own checker required; starting points excluded; home points allowed initially.
- **Why it is balanceable:** it prevents one pin without moving a checker or protecting a whole board. Home-board targeting can be disabled if playtests make late games too safe.
- **Temporary presentation:** a translucent copy of the anchored checker stands in front of its stack with a shield marker. It is non-interactive and disappears with the public effect.

### Jinx

- **Timing:** `WITH_END_TURN`
- **Target:** the opponent.
- **Effect:** on the opponent’s next movement roll, reduce the configured higher or lower effective movement token by the configured penalty, without changing the physical dice. The result never falls below the configured floor or rises above the physical value. Equal tokens created this way remain the original number of tokens.
- **Limits:** by default an actual double is unaffected and consumes the Jinx. If a configured roll does not consume it, the Jinx remains public until an eligible roll or its draft-boundary expiry.
- **Default config:** penalty `1`, minimum token `1`, highest-token targeting, doubles unaffected but consuming, one-token double handling, expiry at the next draft boundary.
- **Why it is balanceable:** its maximum cost is one pip and it cannot remove a die. Whether doubles consume it is a simple strength knob.

### Clear Skies

- **Timing:** `BEFORE_ROLL`
- **Target:** one hostile active effect affecting the player, one of their checkers, or one of their controlled points.
- **Effect:** remove that effect and, when configured above one, additional eligible effects in public effect order up to the configured maximum.
- **Limits:** if there is no legal target, the card is not playable.
- **Default config:** remove one hostile effect tagged `CONTROL` or `DICE_PENALTY`; do not remove opponent positive effects.
- **Why it is balanceable:** it provides visible counterplay to control cards but can be held as a dead card. If that feels too narrow, let it also remove one opponent Bastion.
- **Implementation note:** active effects have first-class public `EFFECT` targets. Clear Skies is validated and resolved in its pre-roll timing module; local and online clients send only the chosen effect instance, while the shared transition determines every removed effect and consumes the card atomically.

### Recast

- **Timing:** `AFTER_ROLL_BEFORE_MOVE`
- **Target:** one of the two physical dice.
- **Effect:** after pressing **Use**, click either highlighted physical die. The authority validates that die index, supplies and records every sampled value, and both clients visibly throw only the selected die while the other remains stationary.
- **Limits:** the turn still has two movement tokens. A newly matching pair is not a double; an original double that is broken still keeps four total tokens, with only one token changed.
- **Default config:** one reroll, final result required, all movement rolls allowed, created matches do not become doubles. Optional acceptance is rejected by profile validation until a separate preview/accept authority phase is designed.
- **Why it is balanceable:** it has familiar risk and an exact expected-value knob. The original-double rule must be shown clearly in the UI.

### Nudge

- **Timing:** `AFTER_ROLL_BEFORE_MOVE`
- **Target:** one movement token from a non-double roll.
- **Effect:** change it by exactly `+1` or `-1`, staying in the range 1–6.
- **Limits:** cannot create four moves and cannot be played on an original double.
- **Default config:** adjustment exactly `1` in either direction, original non-doubles only, bearing-off use enabled, created matches remain two tokens.
- **Why it is balanceable:** it changes at most one pip but creates tactical landing and bearing-off choices. Bearing-off use can be disabled independently if it proves too efficient.

### Flip

- **Timing:** `AFTER_ROLL_BEFORE_MOVE`
- **Target:** one movement token from a non-double roll.
- **Effect:** replace its value with the opposite face: `1↔6`, `2↔5`, or `3↔4`.
- **Limits:** the turn still has two tokens even if the values match afterward.
- **Default config:** mapping `1↔6`, `2↔5`, `3↔4`; original non-doubles only; created matches remain two tokens.
- **Why it is balanceable:** the large change is not always an improvement and is fully visible. It is a good high-variance alternative to Nudge, but the first launch may include only one of the two.

### Ward

- **Timing:** `WITH_END_TURN`
- **Target:** the player.
- **Effect:** cancel the next hostile powerup that would target that player, their checker, or their controlled point.
- **Limits:** expires when triggered or when the next draft opens. It does not stop passive effects.
- **Default config:** block one hostile powerup; expire at the next draft; passive effects excluded.
- **Why it is balanceable:** the opponent can see and wait out the Ward. Expiry prevents permanent defensive stockpiling.

## Recommended prototype passives

Passives should always show their benefit and drawback together. The default version-one profile permits one equipped passive, so interactions between multiple passives do not need rules until a profile raises that cap.

### Loaded Knuckles

- **Benefit:** the first die is fair. The second matches it with probability `1/3`; otherwise it is uniform among the other five faces.
- **Drawback:** doubles grant three movement tokens instead of four.
- **Default config:** exact match chance `1/3`; non-match faces uniform; doubles give three tokens.
- **Implemented interaction:** a powerup configured to turn a modified pair into a double also uses this passive's configured double-token count.
- **Why it is promising:** it doubles the chance of doubles but keeps expected movement count and expected movement pips approximately equal to classic dice. It changes variance and tactics rather than simply adding speed.
- **Authority note:** online generation belongs on the server. State records the physical roll and that Loaded Knuckles modified its distribution.

### Quartermaster

- **Benefit:** powerup capacity increases from two to three.
- **Drawback:** after using a powerup, the player cannot use another on their next own turn.
- **Default config:** one extra slot and one own-turn cooldown after use.
- **Replacement rule:** replacing Quartermaster clears its cooldown. Powerups already occupying its extra slot remain public and usable, but the smaller capacity prevents inventory growth until use brings the count back under the cap.
- **Why it is promising:** it rewards planning and draft flexibility without increasing how many cards can be played in a burst. Capacity and cooldown are independent tuning knobs.

### Home Guard

- **Benefit:** the player’s single checkers on their own home points cannot be pinned.
- **Drawback:** the player cannot pin an opponent’s singleton on the opponent’s home points.
- **Limits:** both starting points are excluded from the benefit and drawback.
- **Default config:** both effects apply only to the respective home zone; starting points excluded.
- **Implementation note:** the configured booleans are copied into public passive-policy state when the card is drafted or replaced. Legal-move generation consumes that state for local play and on the server, so UI previews and authoritative validation agree.
- **Why it is promising:** it creates a clear defensive identity with a mirrored offensive cost and preserves mother outcomes.

### Overdrive

- **Benefit:** once per round, after rolling and before moving, nominate one movable checker and add a bonus movement token of 1 usable only by that checker.
- **Drawback:** that checker is exhausted during the player’s next turn: it cannot leave its point during that turn, though friendly checkers may land there.
- **Limits:** the bonus follows normal landing rules and cannot be used from or onto a starting point.
- **Default config:** once per round; one bonus token of value `1`; one-own-turn exhaustion; starting points excluded.
- **Why it is balanceable:** reward, cooldown, bonus size, and exhaustion duration are explicit. It is more complex than the first three passives and should be added only after timed checker effects are proven.

### Opportunist

- **Benefit:** when the opponent’s initial movement roll has no legal move, gain one Focus token, to a maximum of one. Spend Focus after a later own roll to apply Nudge without consuming a powerup.
- **Drawback:** powerup capacity is one instead of two.
- **Default config:** trigger on an opponent’s initial roll with zero legal moves; gain one Focus up to a cap of one; adjustment `±1`; one Focus use per roll; equipped capacity one.
- **Additional knobs:** Focus gained per trigger, uses per roll (one or two), allowed roll kinds, adjustment directions, bearing-off permission, and whether a created match becomes a double are independent settings.
- **Implementation note:** Focus is a public passive counter. It is earned only during initial roll resolution, spent through the same authoritative post-roll command as dice powerups, does not consume the passive, and does not count against the powerup-per-turn limit.
- **Why it is balanceable:** the trigger is uncommon and visible, while the reduced inventory matters every draft. Measure trigger rate before changing either side.

### Steady Hand

- **Benefit:** once per round after a non-double roll, the player may replace both movement tokens with two copies of either rolled value. These remain two tokens.
- **Drawback:** natural doubles grant three movement tokens instead of four.
- **Default config:** once per round; choose either rolled value; natural doubles give three tokens.
- **Why it is balanceable:** the strong choice is limited to once per round and trades away double strength. It needs simulation and should start in an experimental pool rather than the default pool.

## Experimental powerups

These ideas are compatible with the architecture but should not be in the first balance pool.

| Card              | Proposed effect                                                                                       | Main risk / tuning knob                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tailwind          | After a roll totaling 7 or less, add one bonus token of 1 that cannot bear off.                       | Extra moves interact with maximum-dice search; restrict to one named checker if too flexible. |
| Deep Freeze       | Frost Seal may target a home point but lasts only until the opponent makes their first legal move.    | Could decide bearing-off races or create confusing partial-turn expiry.                       |
| Counterweight     | Replace one die with `7 - value`, then reduce the other die by 1.                                     | Two-token transformation is harder to read; compare its pick rate with Flip.                  |
| Rally             | Remove exhaustion/freeze from one own checker and grant it a token of 1.                              | Combines counterplay and tempo; the bonus may need removal.                                   |
| Second Foundation | Turn one own singleton into a Bastion for two opponent turns, but that checker cannot move meanwhile. | Long duration and self-lock can create board stalls.                                          |
| Draft Compass     | During the owner’s pick, replace one unclaimed offer with a newly sampled card before choosing.       | Adds randomness and authority work inside the draft; limit to once per game if ever used.     |

## Experimental passives

| Passive         | Benefit                                                                               | Drawback                                      | Concern                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Heavy Crown     | Add 1 to the displayed draft-order result, capped at 6.                               | Powerup capacity is one.                      | Alters access to every other card; monitor draft-win correlation carefully.              |
| Pacifist        | Own singletons cannot be pinned.                                                      | The player cannot pin opponent singletons.    | Can create long stalls and removes too much of Plakoto’s identity.                       |
| Long Stride     | Every rolled 1 becomes a movement token of 2.                                         | Every rolled 6 becomes a movement token of 5. | Board-state value swings sharply; may be fair on average but frustrating near bear-off.  |
| Icebreaker      | The player may move checkers out of a Frost Seal, but still cannot land on the point. | Natural doubles grant only three tokens.      | Too dependent on one opposing card unless more control effects are added.                |
| Patient Planner | The player may equip two passives.                                                    | Powerup capacity becomes zero.                | Passive combinations multiply test and balance complexity; not suitable for version one. |

## Ideas deliberately deferred

### “More doubles, but only move on red columns”

The theme is good, but the literal restriction is a poor first implementation:

- point color is currently presentation, not a logical board property;
- some rolls could become unusable solely because the 3D skin changed;
- access to colored points varies dramatically by position and direction;
- it complicates the maximum-usable-dice and higher-die rules; and
- it can produce a passive that is either dominant or effectively disables its owner.

**Loaded Knuckles** keeps the exciting part—more doubles—with a mathematically legible drawback. If colored routes are revisited, define logical route tags independent of textures and prototype them as a separate ruleset.

### Pin escape, teleport, and forced enemy movement

These effects are tempting but touch stack ordering, checker identity, pin ownership, animation, mother outcomes, and the 30-checker invariant. They should wait until the simpler effect system is stable. Any future version must state exactly where a checker goes, whether the movement uses dice, and how a checker underneath a stack can be removed without reordering the remaining stack incorrectly.

### Extra turns and skipped turns

They distort round counting and can create long periods without input for one player. Prefer one-turn point restrictions or small dice changes. If extra turns are ever added, the round tracker’s per-player completion flags make the desired behavior explicit instead of assuming strict alternation.

## Initial pool recommendation

For the first playable balance test, enable only:

- Powerups: **Frost Seal, Bastion, Jinx, Clear Skies, Recast, and Nudge**.
- Passives: **Loaded Knuckles, Quartermaster, Home Guard, and Opportunist**.

This is enough variety to test control, protection, dice adjustment, counterplay, inventory strategy, and passive tradeoffs without enabling every high-complexity hook at once. Add Flip, Ward, and Overdrive only after the first set has reliable UI explanations and online tests.

## Balance questions for playtests

1. Does winning the draft-order roll predict winning the game too strongly?
2. How often does Frost Seal remove an entire turn, and does that feel earned or arbitrary?
3. Are Recast and Nudge both attractive, or is one always the correct pick?
4. Do players hold Clear Skies too long because its target is too narrow?
5. Does Loaded Knuckles feel different while remaining close to neutral in total movement?
6. Does Home Guard reduce pinning—the central Plakoto interaction—too much?
7. Are players forced to replace cards often enough to create decisions, but not so often that rewards feel wasted?
8. Does a three-round interval create two to four drafts in a typical game? If not, tune the interval before making individual cards stronger.
