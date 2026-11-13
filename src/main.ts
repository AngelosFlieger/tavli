import './style.css';
import './gameplay-hud.css';
import './title.css';
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
import { GameController } from './app/game-controller';
import { createGameplayActions } from './app/gameplay-actions';
import { createOnlineGameFlow } from './app/online-game-flow';
import { createMatchSession } from './app/match-session';

const host = document.querySelector<HTMLElement>('#scene')!;
const boardFrame = document.querySelector<HTMLElement>('#board-frame')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const session: Session = {
  onNewGame() {},
  canNewGame: () => false,
  onLocal() {},
  onMultiplayer() {},
};
initShell(session);

async function start() {
  const stage = await createStage(host, boardFrame);
  const controller = new GameController();
  let actions: ReturnType<typeof createGameplayActions>;
  let dice: Awaited<ReturnType<typeof createDice>> | undefined;
  const gameplay = await createGameplay(
    stage.root,
    stage.center,
    stage.camera,
    stage.canvas,
    reducedMotion,
    stage.layout,
    controller,
    {
      onChange: syncShell,
      onMove: (sequence) => actions.move(sequence),
      onUndo: () => actions.undo(),
      onRestart: () => actions.restart(),
    },
  );
  actions = createGameplayActions(controller, gameplay, { reset: () => dice?.reset() });
  session.onNewGame = () => actions.restart();
  session.canNewGame = () => actions.canRestart();

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
  let onlineFlow: ReturnType<typeof createOnlineGameFlow> | undefined;
  stage.mount(() => {
    gameplay.resize();
    if (controller.hasRemoteMove) onlineFlow?.finishRemoteMove();
    else actions.finishInterruptedMove();
    dice?.resize();
  });
  dice = await createDice(stage.root, stage.center, reducedMotion, stage.layout, {
    canRoll: () => actions.beginRoll(),
    finish: () => actions.finishTurn(),
    player: () => controller.throwingPlayer,
    settled: (values) => actions.receiveRoll(values),
    scripted: () => controller.scripted,
    presented: () => onlineFlow?.presentedRoll(),
  });
  onlineFlow = createOnlineGameFlow(controller, gameplay, dice);

  const match = createMatchSession(
    controller,
    onlineFlow,
    gameplay,
    { setSearching, showNote, showTitle, enterTable },
    connectTable,
  );
  session.onLocal = match.startLocal;
  session.onMultiplayer = match.toggleSearch;

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
