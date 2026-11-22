# Tavli

[![CI](https://github.com/AngelosFlieger/tavli/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/AngelosFlieger/tavli/actions/workflows/ci.yml)
[![Mutation testing](https://github.com/AngelosFlieger/tavli/actions/workflows/mutation.yml/badge.svg?branch=main&event=push)](https://github.com/AngelosFlieger/tavli/actions/workflows/mutation.yml)
[![Security](https://github.com/AngelosFlieger/tavli/actions/workflows/security.yml/badge.svg?branch=main&event=push)](https://github.com/AngelosFlieger/tavli/actions/workflows/security.yml)

Two-player [Plakoto](https://en.wikipedia.org/wiki/Plakoto). Three.js, TypeScript, and Vite.

The title screen offers two rulesets: core Plakoto and a configurable Powerups mode. Powerups has authoritative drafts, public inventories, six initial expendable powers (Frost Seal, Bastion, Jinx, Clear Skies, Recast, and Nudge), and four passives (Loaded Knuckles, Quartermaster, Home Guard, and Opportunist). See the [game specification](docs/game-spec.md), [powerups implementation plan](docs/powerups-plan.md), [ability catalog](docs/ability-catalog.md), [architecture map](docs/architecture.md), [refactor plan](docs/refactor-plan.md), and [agent guidelines](AGENTS.md) for the current behavior, proposals, and development conventions.

Ability inventories appear as overlapping cards beside each player. Select a card to inspect its full rules, then press **Use** when its timing window is available. Draft order is presented once when the dialog opens, with one animated, player-colored die per avatar; after the decisive roll, the current picker’s avatar remains beside the choices. Recast highlights the two physical dice so its owner can click the die to reroll, and only that die is thrown again. Temporary board effects make Frost Seal and Bastion visible during balance testing.

## Run

Node.js 24.11+ is required; Node 26 LTS is recommended and used by CI. The repository pins pnpm
11.29.0 so local development and CI resolve the same dependency graph. Install it once with
`npm install --global pnpm@11.29.0` if `pnpm --version` is unavailable.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. Vite also prints a Network address: anyone on the same Wi-Fi can open that and click Multiplayer. The dev server and the game server start together. The game server listens on port 3001; the page proxies it.

```sh
pnpm verify      # check plus the local browser path (about 20s): run before most commits
pnpm verify:full # check plus both browser paths (about 70s): run before pushing
pnpm check       # build, coverage-gated tests, lint, and formatting in parallel (about 10s)
pnpm test
pnpm test:coverage
pnpm test:property
pnpm test:mutation     # deeper core-rules mutation analysis (about 2-3 min initially)
pnpm test:mutation:dry # validate the mutation runner without executing mutants
pnpm lint
pnpm typecheck
pnpm test:browser        # local play plus two-seat online drafts/ability smoke test (about 1 min)
pnpm test:browser:local  # local play path only, for presentation changes (about 10s)
pnpm build
pnpm start          # serve dist/ and the game server on port 3000
pnpm format       # apply Prettier and semantic logic-section spacing
pnpm format:check # verify both formatting layers without writing files
```

GitHub Actions runs the type, coverage, lint, formatting, build, and browser checks on the minimum Node 24.11 runtime and the recommended Node 26 runtime. Formatting combines Prettier's syntax layout with the repository's semantic-spacing pass; see the [code readability guidelines](docs/code-style.md). Coverage must stay above 89% of lines, 79% of branches, and 87% of functions across loaded `src` and `server` modules; each verification job publishes the measured percentages in its GitHub summary. A separate CI job mutation-tests relevant changes to pure movement, position, outcome, opening authority, and their variant policies, while completing successfully as skipped for unrelated changes so it can safely be required. It enforces an 80% floor against an established baseline above 85%, publishes the measured score, has a ten-minute timeout, and uploads its HTML and JSON reports when it fails. Mutation analysis remains outside the fast local `check` loop. Security CI runs CodeQL over TypeScript and workflow files, audits the current lockfile weekly, and rejects pull requests that introduce dependencies with moderate-or-higher known vulnerabilities. The browser smoke test finds Chrome in the common Linux locations. Set `PLAKOTO_CHROME_PATH` when using another compatible executable. Both smoke variants log elapsed seconds per stage, pick a free port pair so leftover servers never block a run, and `pnpm test:browser:headed` shows the browser window at full resolution.

pnpm stores package contents once and links them into each project, reducing duplicate disk use.
Version 11 remains pinned while GitHub's dependency graph has incomplete support for pnpm 12's
two-document lockfile; revisit the pin when GitHub supports that format.

Development builds also show local balance-playtest controls in Settings. Leave the seed blank for fresh cryptographic randomness on every new game, or enter an unsigned 32-bit seed when a balance run must be reproducible. The same profile and explicit seed reproduce dice, draft offers/order, passive probability checks, and powerup rerolls. During that game, Settings can download an in-memory JSON report with semantic events, public effect snapshots, picks, uses, stalled turns, and the result. Settings can also import multiple reports, show a compact comparison, and download aggregate JSON. Aggregation keeps distinct configuration hashes separate and distinguishes completed hold times from unfinished, censored observations. Production builds do not expose these controls, and no report data is sent anywhere.

Stop `pnpm dev` before `pnpm start`. Both want port 3000.

### Operations

The server validates `PORT`, `PLAKOTO_MONGO_URL`, and `PLAKOTO_DB_NAME` at startup and exits with a clear error for unsafe values. `GET /healthz` reports process liveness and `GET /readyz` checks MongoDB. WebSocket frames are capped at 64 KiB and limited to 20 messages per second with a burst of 40; HTTP requests share a per-address token bucket. Responses include a restrictive content-security policy, frame, referrer, permissions, and MIME-sniffing headers. Hashed Vite assets are cached immutably, non-hashed media for one day, and HTML is never cached.

Accounts, login sessions, and live matches are stored in MongoDB. Passwords use versioned scrypt parameters; an account with the earlier hash format is upgraded after its next successful login. Session cookies contain a strictly validated 32-byte random token, while MongoDB stores only its SHA-256 lookup digest. The game uses `mongodb://127.0.0.1:27017` and the `plakoto` database. In Compass, connect to that address and open `plakoto`. The collections are `users`, `sessions`, `matches`, `playing`, and `queue`. Start the local MongoDB server before `pnpm dev`. Run one game server per database; the server owns live authoritative sessions and clears stale queue entries when it starts.

## Multiplayer

The page asks you to create an account or sign in before the menu. Email and username both have to be unique. The browser keeps an HttpOnly cookie for 30 days, so a later visit skips the form. Sign out is in Settings.

Choose Classic or Powerups, then click Multiplayer to wait. The next person searching for the same ruleset and balance profile joins you; Classic and Powerups players never share a queue. Or click Private room to generate a six-character code and share it with a friend, who enters it to join your table directly. The first person plays crimson. Once the table loads, the server automatically throws one die for each player together; the higher die decides who takes the first turn and ties throw both again. The server rolls the dice, drafts, and ability randomness and checks every move; the browsers show the authoritative result. Use Cancel to stop searching. A dropped connection can resume for 45 seconds; a paired opponent who never connects loses after 20 seconds. Either player can Resign, and Settings can leave the table; exiting before the game ends counts as abandoning it and releases both accounts. A finished game offers a rematch only after both players accept. A completed game stays in the database with its final position, winner, and result kind.

Online matches use a server-owned clock. The automatic opening has no player deadline; after it resolves, each turn gets 2 minutes and a 15-second bank. Draft phases pause the clock. The same values apply to every table on the server and can be changed with `PLAKOTO_CLOCK_TURN_SECONDS` and `PLAKOTO_CLOCK_BANK_SECONDS`; set `PLAKOTO_CLOCK=off` to disable clocks. When the active player's deadline expires, the opponent wins with a timeout result.

To share the game running on this Mac, leave `pnpm dev` or `pnpm start` going and start a tunnel:

```sh
~/.local/bin/cloudflared tunnel --url http://localhost:3000
```

Send the `https://….trycloudflare.com` address it prints. This Mac has to stay awake. The address changes the next time you start the tunnel.

## Layout

- `src/game` — rules and point paths
- `src/net` — matchmaking and the socket client
- `server` — the WebSocket server
- `src/scene` — board, checkers, dice, and the WebGL frame
- `src/ui` — start screen, rules, settings
- `src/app/playtest-report.ts`, `playtest-analysis.ts` — local balance report recording and aggregation
- `public/models` — the GLB files the game loads
- `assets` — Blender source, textures, and FBX exports. `assets/source/build_assets.py` writes a fresh set to `assets/source/generated/` and does not replace `public/models`

## Play

Local Game is two players on one device. Rules and Settings are the icon buttons in the top-right corner; New game and Exit game are in Settings. Exit game returns to the title screen and discards an unfinished local game. The interface is available in English and Greek; choose a language in Settings and it is remembered on this device. Completed local and online games are recorded in an on-device match history; Settings can clear the history or all saved preferences and data.

The opening automatically throws one player-colored die for each player at the same time. The higher die starts, ties throw both again, and the starter then rolls a normal pair for the first turn. Click highlighted checkers to pick up one or more, then place them in pickup order. A regular roll can hold up to two and doubles up to four, provided each can still make a legal move. A ghost shows the next landing position while you hover over a legal point. Use **Put back last** or Escape to release a pickup; Shift-click a source when it is also a destination. A combined move is one action when every step along the way is legal and still leaves queued checkers placeable. Undo takes back the last action. End Turn is available once every required move has been played, including when a roll has no legal move.

The game is kept in memory. Motion, grain, and sound choices are saved on this device.
