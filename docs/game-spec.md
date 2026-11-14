# Game specification: implemented baseline

This document describes the current code, not every possible Plakoto rule or the proposed variant. The game is a single two-player Plakoto game with local play on one device or an online match. Random events, powerups, and abilities are future goals; their mechanics are still undecided.

## Board and players

| Item        | Current behavior                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Players     | Player 0 is crimson and player 1 is ivory. Each owns 15 checkers.                                                                            |
| Checker IDs | `0–14` are crimson; `15–29` are ivory. IDs are stable through moves and animation.                                                           |
| Points      | The board has 24 physical points, numbered `0–23`. `board[point]` stores checker IDs from bottom to top; `off[player]` stores borne-off IDs. |
| Start       | All crimson checkers start on point `0`; all ivory checkers start on point `12`.                                                             |
| Movement    | Crimson follows `0 → 1 → … → 11 → 23 → 22 → … → 12`. Ivory follows `12 → 13 → … → 23 → 11 → 10 → … → 0`. The paths are exact reversals.      |
| Home        | Crimson's final six points are `17, 16, 15, 14, 13, 12`; ivory's are `5, 4, 3, 2, 1, 0`.                                                     |

`src/game/points.ts` is the source of truth for physical point IDs and paths. Portrait layout stretches the rendered board but retains the same point IDs and rules.

## Starting and taking turns

1. Player 1 (crimson) rolls two dice, then Player 2 (ivory) rolls two dice. The higher **sum** starts. Equal sums make both players roll again in the same order.
2. The starter rolls a fresh pair for the first actual turn. Later turns alternate.
3. Two different dice give one movement per die. Doubles give four movements of that value.
4. The player must use the maximum number of available movements possible from the current position. If either of two different dice could be used but both cannot, the higher die is required. If only the lower die is playable, it may be used. Winning moves can end play immediately.
5. A checker can consume several dice in one selected action if each intermediate landing is legal. This includes two to four steps with doubles. One Undo reverses that whole selected action.
6. After all required movements have been made, or when none are legal, the turn enters `TURN_COMPLETE`. The player presses **End Turn** to hand play to the opponent. Undo remains available for actions already made in that turn.

During a turn, players may pick up multiple checkers before placing any. The local pickup queue is ordered: the first checker picked up is placed first, and remaining checkers stay in hand. A regular roll can hold at most two, while doubles can hold at most four. A checker can be added only if the queued checkers can each make a legal placement in that order with the remaining dice. Destinations for the first checker are filtered to preserve those later placements. Clicking the same source again picks up the next checker in its stack when legal. **Put back last** removes the latest pickup; Escape clears the queue. Shift-click gives pickup priority when a point is both a source and a destination. The queue is presentation state and is not sent to the server; each placed move remains server-validated.

The authoritative `GameState.phase` values are `OPENING_ROLL`, `WAITING_FOR_ROLL`, `WAITING_FOR_MOVE`, `TURN_COMPLETE`, and `GAME_OVER`. A roll or move resolves to its resulting phase as soon as the command is accepted. The application controller temporarily locks input while local dice or checker animation plays, or while an online result is pending; these waits are not part of shared game state.

## Landing, pinning, and bearing off

- A checker may land on an empty point, a point controlled by its own player, or a point occupied by exactly one opposing checker. Landing on that lone enemy **pins** it underneath; no checker is hit or sent to a bar.
- The top checker controls a point. A pinned checker cannot move, and its owner cannot land on that point while the opponent controls it. Multiple friendly checkers can sit above a pinned checker; the pin ends when the last controlling checker leaves.
- A player may bear off only when all of their remaining board checkers are on their six home points and none of their checkers is pinned.
- A die bears off a checker exactly its distance from the exit. A larger die may bear off only a checker on the highest occupied point, meaning the one farthest from the exit among that player's remaining checkers. Moving within home is also allowed when legal.
- A bear-off move uses destination `-1` in the engine and wire protocol.

## End of game

| Result         | Condition                                                                                                                                   | `Outcome.points` |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: |
| Normal win     | A player bears off all 15 and the opponent has borne off at least one.                                                                      |                1 |
| Mars           | A player bears off all 15 and the opponent has borne off none.                                                                              |                2 |
| Mother victory | A player pins the opponent's sole checker on the opponent's starting point, and the winner has no checker left on their own starting point. |                2 |
| Draw           | Both players' mothers are pinned. This check precedes individual wins.                                                                      |                0 |

The result stores a winner (`null` for a draw), points, and a reason string. The UI shows the winner and reason; points are **not** displayed or added to a match score. New game resets to the opening setup.

## Local and online behavior

- Local play is two people sharing one device. Dice values are sampled in the browser with `crypto.getRandomValues`; the visible die orientation is read back as the result.
- Online play requires an account. The oldest waiting account is paired with the next. The first joined player gets crimson and the first opening roll. The server chooses dice with `node:crypto.randomInt`, validates commands and move sequences, and sends the resulting state to both clients. A client can act only for its assigned player on that player's turn.
- Either online player can request a restart. Signing out or cancelling ends the match for both players and keeps it, with the player who stayed recorded as the winner. A dropped connection keeps the seat for 45 seconds; after that the same record is kept. A game played to a result keeps its final position and winner. Next game starts a new match.
- Motion, texture, and sound preferences persist in local storage. The account session is an HttpOnly cookie. Email and username are unique. Local games are not saved.

## Planned variant decisions

The intended game will add random events, powerups, and abilities, but no specific effects, inventories, cooldowns, or triggers exist today. Before implementing a mechanic, specify its trigger and timing, targets, effect and duration, stacking rules, interaction with pinning/bearing off/wins, whether it can be undone, and how it appears in both local and online state. Online random outcomes must be selected by the server. The baseline above should remain playable and testable as a distinct ruleset if a variant mode is introduced.
