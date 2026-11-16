# Tavli

Two-player [Plakoto](https://en.wikipedia.org/wiki/Plakoto). Three.js, TypeScript, and Vite.

The title screen offers two rulesets: core Plakoto and a configurable Powerups mode. Powerups has authoritative drafts, public inventories, six initial expendable powers (Frost Seal, Bastion, Jinx, Clear Skies, Recast, and Nudge), and four passives (Loaded Knuckles, Quartermaster, Home Guard, and Opportunist). See the [game specification](docs/game-spec.md), [powerups implementation plan](docs/powerups-plan.md), [ability catalog](docs/ability-catalog.md), [architecture map](docs/architecture.md), [refactor plan](docs/refactor-plan.md), and [agent guidelines](AGENTS.md) for the current behavior, proposals, and development conventions.

Ability inventories appear as overlapping cards beside each player. Select a card to inspect its full rules, then press **Use** when its timing window is available. Draft order is presented once when the dialog opens, with one animated, player-colored die per avatar; after the decisive roll, the current picker’s avatar remains beside the choices. Recast highlights the two physical dice so its owner can click the die to reroll, and only that die is thrown again. Temporary board effects make Frost Seal and Bastion visible during balance testing.

## Run

Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Vite also prints a Network address: anyone on the same Wi-Fi can open that and click Multiplayer. The dev server and the game server start together. The game server listens on port 3001; the page proxies it.

```sh
npm test
npm run typecheck
npm run test:browser # local play plus two-seat online drafts/ability smoke test; requires Chrome or Chromium
npm run build
npm start          # serve dist/ and the game server on port 3000
npm run format:check
```

GitHub Actions runs the type, unit, formatting, build, and browser checks. The browser smoke test finds Chrome in the common Linux locations. Set `PLAKOTO_CHROME_PATH` when using another compatible executable.

Development builds also show local balance-playtest controls. Leave the seed blank for fresh cryptographic randomness on every new game, or enter an unsigned 32-bit seed when a balance run must be reproducible. The same profile and explicit seed reproduce dice, draft offers/order, passive probability checks, and powerup rerolls. During that game, Settings can download an in-memory JSON report with semantic events, public effect snapshots, picks, uses, stalled turns, and the result. Settings can also import multiple reports, show a compact comparison, and download aggregate JSON. Aggregation keeps distinct configuration hashes separate and distinguishes completed hold times from unfinished, censored observations. Production builds do not expose these controls, and no report data is sent anywhere.

Stop `npm run dev` before `npm start`. Both want port 3000.

Accounts, login sessions, and live matches are stored in MongoDB. The game uses `mongodb://127.0.0.1:27017` and the `plakoto` database. In Compass, connect to that address and open `plakoto`. The collections are `users`, `sessions`, `matches`, `playing`, and `queue`. Start the local MongoDB server before `npm run dev`. Run one game server per database; the server owns live authoritative sessions and clears stale queue entries when it starts.

## Multiplayer

The page asks you to create an account or sign in before the menu. Email and username both have to be unique. The browser keeps an HttpOnly cookie for 30 days, so a later visit skips the form. Sign out is in Settings.

Choose Classic or Powerups, then click Multiplayer to wait. The next person searching for the same ruleset and balance profile joins you; Classic and Powerups players never share a queue. The first person plays crimson and takes the first opening roll; the higher opening total decides who takes the first turn. The server rolls the dice, drafts, and ability randomness and checks every move; the browsers show the authoritative result. Use Cancel to stop searching. A dropped connection can resume for 45 seconds; a paired opponent who never connects loses after 20 seconds. Either player can Resign, and a finished game offers a rematch only after both players accept. A completed game stays in the database with its final position, winner, and result kind.

To share the game running on this Mac, leave `npm run dev` or `npm start` going and start a tunnel:

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

Local Game is two players on one device. Rules and Settings open from the menu; New game is in Settings.

Each player rolls two dice. The higher total starts, ties are replayed, and the starter rolls again for the first turn. Click highlighted checkers to pick up one or more, then place them in pickup order. A regular roll can hold up to two and doubles up to four, provided each can still make a legal move. A ghost shows the next landing position while you hover over a legal point. Use **Put back last** or Escape to release a pickup; Shift-click a source when it is also a destination. A combined move is one action when every step along the way is legal and still leaves queued checkers placeable. Undo takes back the last action. End Turn is available once every required move has been played, including when a roll has no legal move.

The game is kept in memory. Motion, grain, and sound choices are saved on this device.
