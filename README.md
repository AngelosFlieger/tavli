# Tavli

Two-player [Plakoto](https://en.wikipedia.org/wiki/Plakoto). Three.js, TypeScript, and Vite.

## Run

Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Vite also prints a Network address: anyone on the same Wi-Fi can open that and click Multiplayer. The dev server and the game server start together. The game server listens on port 3001; the page proxies it.

```sh
npm test
npm run build
npm start          # serve dist/ and the game server on port 3000
npm run format:check
```

Stop `npm run dev` before `npm start`. Both want port 3000.

## Multiplayer

Click Multiplayer to wait. The next person who does the same joins you. The first person plays crimson and opens. The server rolls the dice and checks every move; the browsers only show the result. Click Multiplayer again to stop searching.

`npm start` is one Node process, so a free host that runs it is enough for people outside your network. Set `PORT` if the host assigns one.

To share the game running on this Mac, leave `npm start` going and start a tunnel:

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
- `public/models` — the GLB files the game loads
- `assets` — Blender source, textures, and FBX exports. `assets/source/build_assets.py` writes a fresh set to `assets/source/generated/` and does not replace `public/models`

## Play

Local Game is two players on one device. Rules and Settings open from the menu; New game is in Settings.

Each player rolls two dice. The higher total starts, ties are replayed, and the starter rolls again for the first turn. Click a highlighted checker, then a destination. A combined move is one action when every step along the way is legal. Doubles allow up to four steps. Undo takes back the last action. End Turn is available once every required move has been played, and a roll with no legal move passes on its own.

The game is kept in memory. Motion, grain, and button-sound choices are saved on this device.
