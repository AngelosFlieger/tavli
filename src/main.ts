import './style.css';
import './responsive.css';
import './waiting.css';
import { preferences } from './ui/preferences';
import {
  enablePlay,
  enterTable,
  initShell,
  setSearching,
  showNote,
  showTitle,
  syncShell,
  type Session,
} from './ui/shell';
import { connectTable } from './net/client';
import { createDice } from './scene/dice';
import { createGameplay } from './scene/checkers';
import { createStartScatter } from './scene/start-scatter';
import { createWaitingScatter } from './scene/waiting-scatter';
import { loadModel } from './scene/assets';
import { createStage } from './scene/stage';

const host = document.querySelector<HTMLElement>('#scene')!;
const boardFrame = document.querySelector<HTMLElement>('#board-frame')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const session: Session = {
  onReset() {},
  onNewGame() {},
  canNewGame: () => false,
  onLocal() {},
  onMultiplayer() {},
};
initShell(session);

async function start() {
  const stage = await createStage(host, boardFrame);
  const gameplay = await createGameplay(
    stage.root,
    stage.center,
    stage.camera,
    stage.canvas,
    reducedMotion,
    stage.layout,
    { onReset: () => session.onReset(), onChange: syncShell },
  );
  session.onNewGame = () => gameplay.restart();
  session.canNewGame = () => gameplay.canRestart();

  stage.attachScatter(createStartScatter(gameplay.checkerArtwork));
  stage.attachWaiting(
    createWaitingScatter(gameplay.checkerArtwork, (await loadModel('Die')).scene),
  );
  const wideStage = matchMedia('(min-aspect-ratio: 1/1)');
  let homeLoading = false;
  const loadHome = () => {
    if (homeLoading || !wideStage.matches) return;
    homeLoading = true;
    void import('./scene/home-falling')
      .then(({ createHomeFalling }) => {
        stage.attachHome(
          createHomeFalling(gameplay.checkerArtwork, stage.center, stage.root.scale.x),
        );
      })
      .catch((error: unknown) => {
        homeLoading = false;
        console.warn('Home decoration unavailable', error);
      });
  };
  wideStage.addEventListener('change', loadHome);
  loadHome();
  let dice: Awaited<ReturnType<typeof createDice>> | undefined;
  stage.mount(() => {
    gameplay.resize();
    dice?.resize();
  });
  dice = await createDice(stage.root, stage.center, reducedMotion, stage.layout, {
    canRoll: () => gameplay.beginRoll(),
    settled: (values) => gameplay.receiveRoll(values),
    scripted: () => gameplay.scripted(),
    presented: () => gameplay.presented(),
  });
  session.onReset = () => dice!.reset();

  let searching = false;
  const table = connectTable({
    onWaiting() {},
    onMatched(you, state) {
      if (!searching) {
        table.cancel();
        return;
      }
      searching = false;
      setSearching(false);
      showNote(null);
      gameplay.join(you, (command) => table.send(command));
      gameplay.applyRemote(state, false);
      dice!.reset();
      enterTable();
    },
    onUpdate(update) {
      if (update.resetDice) {
        gameplay.applyRemote(update.state, update.canUndo, true);
        return;
      }
      if (update.dice) {
        gameplay.queueRoll(update.state, update.canUndo);
        dice!.play(update.dice);
        return;
      }
      if (update.sequence) {
        gameplay.animateMove(update.sequence, update.state, update.canUndo);
        return;
      }
      gameplay.applyRemote(update.state, update.canUndo);
    },
    onLeft() {
      searching = false;
      setSearching(false);
      gameplay.leaveOnline();
      showTitle();
      showNote('Opponent left. Search again to play.');
    },
    onClose() {
      const playing = gameplay.scripted();
      searching = false;
      setSearching(false);
      if (playing) {
        gameplay.leaveOnline();
        showTitle();
      }
      showNote('Can’t reach the game server.');
    },
  });
  session.onLocal = () => {
    if (!searching) return;
    searching = false;
    setSearching(false);
    table.cancel();
  };
  session.onMultiplayer = () => {
    if (searching) {
      searching = false;
      setSearching(false);
      table.cancel();
      showNote(null);
      return;
    }
    searching = true;
    setSearching(true);
    showNote(null);
    table.find();
  };

  enablePlay();
  gameplay.refresh();
  syncShell();
  status.hidden = true;

  stage.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    status.textContent = 'Graphics connection lost. Reload the page to restore the board.';
    status.hidden = false;
  });

  let elapsed = 0;
  let last = performance.now();
  stage.setLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (document.hidden) return;
    if (!reducedMotion.matches && preferences.motion) elapsed += dt;
    stage.render(elapsed, !reducedMotion.matches && preferences.motion, preferences.texture, dt);
    dice!.update(dt);
    gameplay.update(dt);
  });
}

start().catch((error: unknown) => {
  console.error(error);
  status.hidden = false;
  status.textContent =
    'The 3D board could not load. Check WebGL support and that public/models/Board.glb is present, then reload.';
});
