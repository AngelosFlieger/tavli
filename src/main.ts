import './style.css';
import './gameplay-hud.css';
import './title.css';
import './responsive.css';
import './waiting.css';
import './draft.css';
import { preferences } from './ui/preferences';
import { loadLocalePreference, t, translateDOM } from './ui/i18n';
import {
  enablePlay,
  enterTable,
  initShell,
  setSearching,
  showNote,
  showRoom,
  showTitle,
  syncShell,
  type Session,
} from './ui/shell';
import { logout, sameOrigin } from './net/account';
import { connectTable } from './net/client';
import { initAuthScreen, restoreSession, showAuth } from './ui/auth-screen';
import { createDice } from './scene/dice';
import { createGameplay } from './scene/checkers';
import { createStartScatter } from './scene/start-scatter';
import { createWaitingScatter } from './scene/waiting-scatter';
import { loadModel } from './scene/assets';
import { createStage } from './scene/stage';
import { GameController } from './app/game-controller';
import type { GameState } from './game/session/state';
import { createGameplayActions } from './app/gameplay-actions';
import { createOnlineGameFlow } from './app/online-game-flow';
import { createMatchSession } from './app/match-session';
import { PlaytestRecorder } from './app/playtest-report';
import { addHistoryEntry, createHistoryEntry, loadHistory, saveHistory } from './app/history';

const host = document.querySelector<HTMLElement>('#scene')!;
const boardFrame = document.querySelector<HTMLElement>('#board-frame')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const session: Session = {
  onNewGame() {},
  canNewGame: () => false,
  onLocal() {},
  onMultiplayer() {},
  onCreateRoom() {},
  onJoinRoom() {},
  onSignOut() {},
  playtestReport: () => null,
};
loadLocalePreference();
translateDOM();
let reconnect = () => {};
initShell(session);
initAuthScreen({
  onSignedIn() {
    reconnect();
  },
});
void restoreSession().then((signedIn) => {
  if (signedIn) reconnect();
});

async function start() {
  const stage = await createStage(host, boardFrame);
  const controller = new GameController();
  const playtest = new PlaytestRecorder();
  let historyMode: 'LOCAL' | 'ONLINE' = 'LOCAL';
  let historyRecordedFor: GameState | null = null;
  controller.setEventSink((events, state) => {
    playtest.record(events, state);
    if (
      preferences.history &&
      state.phase === 'GAME_OVER' &&
      state.outcome &&
      historyRecordedFor !== state
    ) {
      historyRecordedFor = state;
      saveHistory(
        addHistoryEntry(
          loadHistory(),
          createHistoryEntry({
            mode: historyMode,
            ruleset: state.ruleset,
            outcome: state.outcome,
            rounds: state.powerups?.completedRounds ?? 0,
          }),
        ),
      );
    }
  });
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
      onForfeit: () => actions.forfeit(),
      onRollAbility: (option) => actions.playRollAbility(option),
      onBeforeRollAbility: (target) => actions.playBeforeRollAbility(target),
    },
  );
  actions = createGameplayActions(controller, gameplay, {
    reset: () => dice?.reset(),
    play: (values, rerolledDie) => dice?.play(values, rerolledDie),
  });
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
  dice = await createDice(
    stage.root,
    stage.camera,
    stage.canvas,
    stage.center,
    reducedMotion,
    stage.layout,
    {
      canRoll: () => actions.beginRoll(),
      finish: () => actions.finishTurn(),
      player: () => controller.throwingPlayer,
      settled: (values) => actions.receiveRoll(values),
      scripted: () => controller.scripted,
      forced: () => controller.takeForcedLocalRoll(),
      presented: () => onlineFlow?.presentedRoll(),
      selectableDice: () =>
        controller.selectedAbility?.abilityId === 'recast'
          ? controller.rollAbilityOptions().map((option) => option.target.index)
          : [],
      selectDie: (index) => {
        if (controller.selectedAbility?.abilityId !== 'recast') return;
        const option = controller
          .rollAbilityOptions()
          .find((candidate) => candidate.target.index === index);
        if (option) actions.playRollAbility(option);
      },
    },
  );
  onlineFlow = createOnlineGameFlow(controller, gameplay, dice);

  const match = createMatchSession(
    controller,
    onlineFlow,
    gameplay,
    {
      setSearching,
      showNote,
      showRoom,
      showTitle,
      enterTable,
      signedOut() {
        void logout();
        showAuth();
      },
    },
    connectTable,
  );
  session.onLocal = (selection, seed) => {
    historyMode = 'LOCAL';
    const accepted = match.startLocal(selection, seed);
    if (!accepted || seed === undefined) {
      playtest.clear();
      return;
    }
    playtest.start({
      mode: 'LOCAL',
      selection,
      seed,
      configHash: controller.state.variantConfigHash,
    });
  };
  session.onMultiplayer = (selection) => {
    historyMode = 'ONLINE';
    playtest.clear();
    match.toggleSearch(selection);
  };
  session.onCreateRoom = (selection) => {
    historyMode = 'ONLINE';
    playtest.clear();
    match.createRoom(selection);
  };
  session.onJoinRoom = (code) => {
    historyMode = 'ONLINE';
    playtest.clear();
    match.joinRoom(code);
  };
  session.playtestReport = () => playtest.snapshot();
  session.onSignOut = () => {
    match.signOut();
    void logout();
    showAuth();
  };
  reconnect = () => match.reconnect();

  enablePlay();
  if (
    sameOrigin() &&
    !document.body.classList.contains('signed-out') &&
    !document.body.classList.contains('auth-pending')
  )
    match.reconnect();
  gameplay.refresh();
  syncShell();
  status.hidden = true;

  stage.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    status.textContent = t('main.graphicsLost');
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
  status.textContent = t('main.boardLoadFailed');
});
