# Tavli

Local two-player [Plakoto](https://en.wikipedia.org/wiki/Plakoto). Three.js, TypeScript, and Vite.

## Run

Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. `npm run dev` and `npm run preview` both use that port.

```sh
npm test
npm run build
npm run format:check
```

## Layout

- `src/game` — rules and point paths
- `src/scene` — board, checkers, dice, and the WebGL frame
- `src/ui` — start screen, rules, settings
- `public/models` — the GLB files the game loads
- `assets` — Blender source, textures, and FBX exports. `assets/source/build_assets.py` writes a fresh set to `assets/source/generated/` and does not replace `public/models`

## Play

Local Game is two players on one device. Multiplayer is only a button. Rules and Settings open from the menu; New game is in Settings.

Each player rolls two dice. The higher total starts, ties are replayed, and the starter rolls again for the first turn. Click a highlighted checker, then a destination. A combined move is one action when every step along the way is legal. Doubles allow up to four steps. Undo takes back the last action. End Turn is available once every required move has been played, and a roll with no legal move passes on its own.

The game is kept in memory. Motion, grain, and button-sound choices are saved on this device.
