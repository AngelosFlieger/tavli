# PLAKOTO — GAME RULES & IMPLEMENTATION SPECIFICATION

## 1. Game Overview

Build a faithful digital recreation of **Plakoto (Πλακωτό)**, one of the three traditional Greek Tavli games.

The game has:
- 2 players.
- 24 triangular points arranged in four quadrants of six.
- 15 checkers per player.
- 2 six-sided dice.
- No hitting or sending pieces to a bar.
- Pinning as the primary mechanic.
- The objective of bearing off all 15 checkers before the opponent.

Follow the rules below exactly. Do not substitute standard backgammon rules.

## 2. Starting Position

Each player begins with all 15 checkers stacked on one starting point.

For our current visual board orientation:

- **Player 1 (Red):** 15 checkers on the top-leftmost playable triangle.
- **Player 2 (Ivory):** 15 checkers on the bottom-leftmost playable triangle.
- Both stacks must be placed INSIDE the playable board, not in the outside storage trays.
- Each player moves in the opposite direction around the board.

### Movement directions

Using player-relative numbering:

Each player moves from their own point 24 toward point 1.

The two players travel in opposite directions around the board, with their home boards located at the opposite ends of their respective paths.

**Important:** Implement the movement paths as explicit ordered arrays of 24 physical point IDs. Do not calculate movement using screen X coordinates alone.

Each player must be able to reach their own home board and bear off.

## 3. Starting the Game

1. Each player rolls one die.
2. The player with the higher roll goes first.
3. If the dice match, roll again.
4. The winning player then rolls both dice to determine their first movement.
5. Players alternate turns after that.

For subsequent games, the winner of the previous game starts.

## 4. Rolling Dice

Each normal turn uses two six-sided dice.

Example: rolling 3 and 5 provides two separate movements.

The player may:
- Move one checker 3 points and another checker 5 points.
- Move the same checker 3 points and then 5 points.
- Move the same checker 5 points and then 3 points.

Each individual movement must be legal.

When moving one checker using both dice, the intermediate landing point must also be legal.

### Doubles

If both dice have the same value, the player gets four movements.

Example: rolling 4–4 provides four separate movements of 4 points each.

### Mandatory dice usage

- Players must use both dice whenever legally possible.
- With doubles, players must use as many of the four movements as possible.
- If only one of two different dice can be played, play that die.
- If either die can be played individually, but both cannot be played together, the higher die must be played.
- If neither die can be played, the turn passes automatically.
- Players cannot voluntarily skip a legal movement.

The game must examine possible move sequences to enforce these rules.

## 5. Legal Movement

A checker may move forward to:

- An empty point.
- A point occupied by friendly checkers.
- A point occupied by exactly one unpinned enemy checker, which becomes pinned.

A checker cannot land on:

- A point controlled by two or more enemy checkers.
- A point where an enemy checker is already pinning a friendly checker.
- Any point otherwise blocked by the opponent.

Checkers cannot move backward.

Checkers cannot move farther than the number shown on the die, except when bearing off under the special bearing-off rules.

## 6. Pinning (Πλάκωμα)

Pinning is the central mechanic of Plakoto.

When a checker lands on a point occupied by exactly one unpinned enemy checker, the enemy checker becomes trapped beneath it.

### Pinning behavior

- The pinned checker cannot move.
- The pinning checker remains free to move.
- Additional friendly checkers may join the pinning checker.
- The pinned checker stays trapped as long as at least one opposing checker remains above it.
- Once all pinning checkers leave, the trapped checker becomes free.
- There is no limit to how many turns a checker may remain pinned.
- A pinned checker cannot be selected for movement.
- A point controlled by the opponent's pinning checker(s) is blocked to the pinned player's other checkers.

### Example

Player 1 has one red checker on point X.

Player 2 lands an ivory checker on point X.

The red checker becomes pinned.

Player 2 adds two more ivory checkers to X.

The red checker remains pinned until all three ivory checkers leave X.

The red checker cannot move while any ivory checker remains on top.

## 7. Mother Checker (Η Μάνα)

The mother checker is the last checker remaining on a player's original starting point.

Pinning the opponent's mother can result in an immediate double victory.

### Rules

- If the opponent's last checker is pinned on its original starting point, the mother rule is triggered.
- The pinning player wins 2 points if their own starting point is already empty.
- If the pinning player still has checkers on their own starting point, the game continues.
- If both mothers become pinned, the game ends in a draw worth 0 points.

The mother rule must be checked immediately after every relevant movement.

## 8. Bearing Off (Μάζεμα)

A player may begin bearing off only when all 15 checkers are in their own home board, points 1–6.

A player cannot bear off if any checker remains outside their home board or is pinned.

### Exact bearing off

A die value matching a checker's point number allows that checker to be removed.

Example:
- Die = 3.
- Checker on point 3.
- Bear off that checker.

### Higher die

If no checker occupies the point matching the die, a checker may be borne off from the highest occupied lower-numbered point, but only if no checker occupies a higher-numbered point.

Example:
- Die = 6.
- Highest occupied point = 4.
- A checker from point 4 may be borne off.

### Lower die

If a die cannot bear off a checker, it may be used to move a checker forward within the home board, provided the movement is legal.

### Additional conditions

- A player may choose to make a legal move inside the home board instead of bearing off.
- Doubles provide four bearing-off/movement actions when possible.
- Mandatory dice usage still applies.
- The first player to bear off all 15 checkers wins.

## 9. Winning and Scoring

### Normal Win — 1 point

A player bears off all 15 checkers, and the opponent has already borne off at least one.

### Mars (Μαρς) — 2 points

A player bears off all 15 checkers before the opponent bears off any.

### Mother Victory — 2 points

A player successfully pins the opponent's mother, subject to the mother-rule exception.

### Draw — 0 points

Both players' mothers become pinned.

### Match format

Support configurable match targets, such as:

- Single game.
- First to 3 points.
- First to 5 points.
- First to 7 points.

Do not implement a doubling cube or standard backgammon's triple-win scoring.

## 10. Turn State Machine

Use explicit turn states:

1. `OPENING_ROLL`
2. `WAITING_FOR_ROLL`
3. `ROLLING`
4. `WAITING_FOR_MOVE`
5. `ANIMATING_MOVE`
6. `TURN_COMPLETE`
7. `GAME_OVER`

### Normal turn flow

1. Identify active player.
2. Enable Roll.
3. Player presses Roll.
4. Animate dice.
5. Generate two values between 1 and 6.
6. Determine available movement values (two normally, four for doubles).
7. Calculate legal move sequences.
8. If no legal moves exist, automatically pass.
9. Allow the player to select a movable checker.
10. Highlight legal destinations.
11. Move the checker to the selected destination.
12. Update pinning, checker positions, and remaining dice.
13. Continue until all required movements are completed.
14. End the turn.
15. Switch active player.

## 11. UI Behavior

Use our approved Balatro-inspired design.

### Player indicators

Display:
- Player 1 — Red.
- Player 2 — Ivory.
- Current active player.
- Match score.

### Roll button

- Enabled only when the active player is allowed to roll.
- Has hover, press-in, release, and bounce feedback.
- Disabled while dice are rolling.
- Disabled after a roll until the next player's turn.

### Dice

- Two separate 3D dice.
- Cream-colored with red pips.
- Physically convincing rolling animation.
- Settle on readable faces.
- Results must match the actual generated values.
- Doubles must be visually recognizable.

### Checker selection

- Hover highlights movable checkers.
- Clicking a checker displays legal destinations.
- Illegal checkers cannot be selected.
- Moving checkers should animate smoothly.
- Pinned checkers should be visibly distinguishable.

### Undo

Allow undoing moves made during the current turn, before the turn is finalized.

Undo must restore:
- Checker positions.
- Pinning state.
- Available dice movements.
- Current legal moves.

### End Turn

- Disabled while mandatory legal moves remain.
- Enabled when the turn is complete.
- Changes the active player.

Use TypeScript for game logic and Three.js for 3D rendering.

## 13. Testing Requirements

Write tests for:

- Correct initial checker positions.
- Opposite movement paths.
- All 24 points per player.
- Normal movement with two different dice.
- Doubles providing four moves.
- Mandatory higher-die usage.
- Illegal intermediate landing points.
- Blocked destinations.
- Pinning one checker.
- Multiple checkers maintaining a pin.
- Releasing pinned checkers.
- Mother pinning and the exception.
- Both mothers pinned.
- Bearing-off eligibility.
- Exact bearing off.
- Higher-die bearing off.
- Normal victory.
- Mars.
- Turn transitions.
- Undo state restoration.

## 14. Development Constraints

- Preserve the existing Balatro-inspired art direction.
- Reuse our existing board and checker assets.
- Do not rebuild the 3D board unnecessarily.
- Avoid introducing standard backgammon hitting mechanics.
- Keep game logic deterministic and testable.
- Do not implement online multiplayer yet.
- Do not introduce AI opponents yet.
- Do not add betting, coins, power-ups, or Balatro-style gameplay modifiers.
- Implement traditional Plakoto only.

**Before implementing movement, explicitly define and verify the physical point numbering and each player's 24-point traversal path against the rendered board.**

Build the game incrementally and validate each milestone before moving on to the next.
