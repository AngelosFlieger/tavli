import './style.css';
import './responsive.css';
import { preferences } from './ui/preferences';
import { enablePlay, initShell, syncShell, type Session } from './ui/shell';
import { createDice } from './scene/dice';
import { createGameplay } from './scene/checkers';
import { createStartScatter } from './scene/start-scatter';
import { createStage } from './scene/stage';

const host = document.querySelector<HTMLElement>('#scene')!;
const boardFrame = document.querySelector<HTMLElement>('#board-frame')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const session: Session = {
  onReset() {},
  onNewGame() {},
  canNewGame: () => false,
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
  let dice: Awaited<ReturnType<typeof createDice>> | undefined;
  stage.mount(() => {
    gameplay.resize();
    dice?.resize();
  });
  dice = await createDice(stage.root, stage.center, reducedMotion, stage.layout, {
    canRoll: () => gameplay.beginRoll(),
    settled: (values) => gameplay.receiveRoll(values),
  });
  session.onReset = () => dice!.reset();

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
    stage.render(elapsed, !reducedMotion.matches && preferences.motion, preferences.texture);
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
