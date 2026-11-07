# Tavli · Plakoto

A local, two-player Plakoto game built with Three.js, TypeScript and Vite. This folder is the sole maintained project: game code, original editable artwork, runtime assets, rules, tests and a full-game recording live here.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. The port is fixed; Vite reports a conflict instead of silently choosing another port.

```sh
npm test          # deterministic rules and combined-move tests
npm run build    # type-check and create dist/
npm run preview  # serve the production build on localhost:3000
npm run format:check
```

Stop the development server before starting the production preview; both use port 3000.

## Project layout

- `src/game/` — deterministic rules, physical point paths and turn state.
- `src/scene/` — original checker meshes, board interaction, movement animation and dice.
- `src/ui/` — portraits, settings/rules overlays and start-screen behavior.
- `src/main.ts` — renderer, camera, lighting, background and scene lifecycle.
- `src/style.css` — shared table and start-screen styling.
- `src/responsive.css` — larger desktop controls and portrait phone layouts, including safe-area spacing.
- `public/models/` — the four self-contained original GLB assets used by the game.
- `assets/source/` — editable Blender source and regeneration script.
- `assets/exports/` and `assets/textures/` — original FBX exports and texture sources; not shipped in the website build.
- `tests/` and `scripts/` — automated rule checks and their test runner.
- `docs/` — supplied rules, verified board map and review media.

The original asset meshes and embedded materials are retained. No images or models depend on the old chat folders or an external image service.

## Play

Choose **Local Game**. Both players use the same device. Multiplayer is a clickable placeholder; Rules and Settings open overlays.

Player 1 rolls two dice, then Player 2. The higher total starts; a tie replays both rolls. The starter rolls again for the first playable turn.

Click a highlighted checker, then a green destination. A combined destination uses two dice in one action when an intermediate route is legal: 4–2 can move directly by 6. Doubles permit up to four steps. Undo restores the whole selected action. End Turn unlocks only after mandatory moves are exhausted; entirely blocked rolls pass automatically.

Pinning, release, mother victories/draws and bearing off follow the rules in `docs/RULES.md`, with the later requested two-dice opening described above. This is a single game without match points. New game is available in Settings.

Portrait gameplay places both player panels above a taller board, hides the in-game logo, and uses large touch controls below. Board proportions and checker positions adapt visually without changing point IDs or movement paths; dice and checker shapes stay unchanged. The game background fills the whole viewport. The numeric dice panel is hidden; values remain available to assistive technology.

Inactive player panels are dimmed. The desktop start screen shows an empty board and portrait-only cards. On phones it replaces the board with a few decorative copies of the original checkers and centers the menu. Counters, point IDs and PIN text are intentionally absent. Dice retain their original materials and readable face values. Throws are animated rather than rigid-body physics simulations.

Games run in memory and restart on reload. Visual/audio preferences persist on this device. No AI opponents, online play, betting or power-ups are implemented.

## Review

`docs/media/gameplay.mp4` is a complete 5:09 recorded playthrough, from the opening rolls to the last bear-off, including combined moves and pinning. `docs/media/start-screen.jpg` shows the latest start screen.
