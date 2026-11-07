import type { BoardLayout } from './layout';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Game, owner, moveSequences, type Move, type Position } from '../game/engine';
import { pointPosition } from '../game/points';

export async function createGameplay(
  root: THREE.Group,
  center: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  reducedMotion: MediaQueryList,
  layout: BoardLayout,
) {
  const game = new Game();
  const roll = document.querySelector<HTMLButtonElement>('#roll')!;
  const undo = document.querySelector<HTMLButtonElement>('footer .secondary')!;
  const end = document.querySelector<HTMLButtonElement>('footer .secondary:last-child')!;
  undo.textContent = '↶ UNDO';
  undo.setAttribute('aria-label', 'Undo');
  end.textContent = 'END TURN →';
  end.setAttribute('aria-label', 'End Turn');
  const hud = document.createElement('section');
  hud.className = 'game-hud';
  hud.innerHTML =
    '<p id="game-message" role="status" aria-live="polite"></p><div id="move-choices"></div><button id="next-game" hidden>Next game →</button>';
  document.body.append(hud);
  const message = hud.querySelector<HTMLElement>('#game-message')!,
    choices = hud.querySelector<HTMLElement>('#move-choices')!;
  const next = hud.querySelector<HTMLButtonElement>('#next-game')!;
  const panels = [
    document.querySelector<HTMLElement>('.player.red')!,
    document.querySelector<HTMLElement>('.player.ivory')!,
  ];
  const controls = document.createElement('div');
  controls.className = 'match-controls';
  controls.innerHTML = '<button id="new-game">New game</button>';
  const overlayContent = document.querySelector('#overlay-content')!;
  new MutationObserver(() => {
    if (overlayContent.querySelector('[data-pref]') && !overlayContent.contains(controls))
      overlayContent.append(controls);
  }).observe(overlayContent, { childList: true });
  controls.querySelector('button')!.addEventListener('click', () => {
    if (game.state.phase === 'ROLLING' || game.state.phase === 'ANIMATING_MOVE') return;
    game.reset();
    selected = null;
    window.dispatchEvent(new Event('plakoto-reset'));
    refresh();
    document.querySelector<HTMLDialogElement>('#overlay')!.close();
  });
  let selected: number | null = null,
    animationTime = 0;
  let animations: {
    object: THREE.Group;
    start: THREE.Vector3;
    end: THREE.Vector3;
    moving: boolean;
  }[] = [];
  const assets = await Promise.all(
    ['Checker_Red', 'Checker_Ivory'].map((name) =>
      new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`),
    ),
  );
  const checkers: THREE.Group[] = [];
  const heights: number[] = [];
  assets.forEach((asset, player) => {
    const bounds = new THREE.Box3().setFromObject(asset.scene),
      size = bounds.getSize(new THREE.Vector3()),
      mid = bounds.getCenter(new THREE.Vector3());
    const scale = 0.0304 / Math.max(size.x, size.z);
    heights[player] = size.y * scale + 0.0004;
    for (let i = 0; i < 15; i++) {
      const checker = new THREE.Group(),
        scaled = new THREE.Group(),
        mesh = asset.scene.clone(true);
      mesh.position.set(-mid.x, -bounds.min.y, -mid.z);
      scaled.add(mesh);
      scaled.scale.setScalar(scale);
      checker.add(scaled);
      root.add(checker);
      checkers[player * 15 + i] = checker;
    }
  });
  function updatePresentation() {
    const title = document.body.classList.contains('on-title');
    checkers.forEach((checker) => (checker.visible = !title));
    canvas.setAttribute(
      'aria-label',
      title
        ? 'Original Plakoto board without checkers'
        : 'Plakoto board with red and ivory checkers',
    );
  }
  updatePresentation();
  window.addEventListener('resize', updatePresentation);
  const hitTargets: THREE.Mesh[] = [];
  const markers: THREE.Mesh[] = [];
  const mat = new THREE.MeshBasicMaterial({
    color: 0xeac678,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  for (let point = 0; point < 24; point++) {
    const { x, z } = pointPosition(point);
    const hit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.034, 0.157),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    hit.rotation.x = -Math.PI / 2;
    hit.position.set(
      x - center.x,
      0.065 - center.y,
      point < 12 ? -0.126 - center.z : 0.126 - center.z,
    );
    hit.userData.point = point;
    root.add(hit);
    hitTargets.push(hit);
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.0163, 0.018, 40), mat.clone());
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x - center.x, 0.028 - center.y, z - center.z);
    root.add(marker);
    markers.push(marker);
  }
  function positions(position: Position = game.state) {
    const targets = new Map<number, THREE.Vector3>();
    position.board.forEach((stack, point) => {
      const { x, z } = pointPosition(point);
      const mixed = stack.length > 1 && owner(stack[0]) !== owner(stack.at(-1)!);
      stack.forEach((id, index) => {
        // A pinned checker is always physically beneath the controller, sharing its first slot.
        const slot = mixed ? Math.max(0, index - 1) : index;
        const y =
          0.0274 +
          Math.floor(slot / layout.stackSlots) * heights[owner(id)] +
          (mixed && index > 0 ? heights[owner(stack[0])] : 0);
        targets.set(
          id,
          new THREE.Vector3(
            x - center.x,
            y - center.y,
            (z - center.z) * layout.depth +
              (point < 12 ? 1 : -1) * (slot % layout.stackSlots) * 0.0305,
          ),
        );
        checkers[id].userData.pinned = mixed && index === 0;
        checkers[id].scale.setScalar(mixed && index === 0 ? 1.06 : 1);
      });
    });
    position.off.forEach((ids, player) =>
      ids.forEach((id, index) =>
        targets.set(
          id,
          new THREE.Vector3(
            0.282 - center.x,
            0.028 + Math.floor(index / 5) * heights[player] - center.y,
            ((player === 0 ? 0.18 : -0.18) - center.z) * layout.depth +
              (player === 0 ? -1 : 1) * (index % 5) * 0.028,
          ),
        ),
      ),
    );
    return targets;
  }
  function sync() {
    for (const [id, pos] of positions()) checkers[id].position.copy(pos);
  }
  let animationStages: Position[] = [];
  let movingChecker = -1;
  function animateStage(stage: Position) {
    animationTime = 0;
    animations = [...positions(stage)].map(([id, end]) => ({
      object: checkers[id],
      start: checkers[id].position.clone(),
      end,
      moving: id === movingChecker,
    }));
  }
  function execute(sequence: Move[]) {
    movingChecker = game.state.board[sequence[0].from].at(-1)!;
    const stages = game.moveSequence(sequence);
    if (!stages) return;
    selected = null;
    animationStages = stages;
    animateStage(animationStages.shift()!);
    refresh(false);
  }
  let sequenceCacheKey = '';
  let cachedSequences: Move[][] = [];
  function selectedSequences() {
    if (selected === null || game.state.phase !== 'WAITING_FOR_MOVE') return [];
    const key = JSON.stringify([
      game.state.board,
      game.state.remaining,
      game.state.active,
      selected,
    ]);
    if (key !== sequenceCacheKey) {
      sequenceCacheKey = key;
      cachedSequences = moveSequences(
        game.state,
        game.state.active!,
        game.state.remaining,
        selected,
      );
    }
    return cachedSequences;
  }
  function refresh(updatePositions = true) {
    if (updatePositions) sync();
    const state = game.state,
      moves = game.moves();
    roll.disabled = !['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(state.phase);
    undo.disabled =
      !game.history.length || !['WAITING_FOR_MOVE', 'TURN_COMPLETE'].includes(state.phase);
    end.disabled = state.phase !== 'TURN_COMPLETE';
    message.textContent = state.message;
    message.hidden = state.phase !== 'GAME_OVER';
    roll.innerHTML = 'ROLL <span>↗</span>';
    roll.setAttribute(
      'aria-label',
      state.opening ? `Player ${state.active! + 1} opening roll` : 'Roll',
    );
    controls.querySelector<HTMLButtonElement>('button')!.disabled = [
      'ROLLING',
      'ANIMATING_MOVE',
    ].includes(state.phase);
    if (selected !== null && !moves.some((move) => move.from === selected)) selected = null;
    panels.forEach((panel, player) => {
      panel.classList.toggle('inactive', state.active !== null && state.active !== player);
      panel.classList.toggle('active', state.active === player && state.phase !== 'GAME_OVER');
      panel.setAttribute(
        'aria-label',
        `Player ${player + 1}${state.active === player ? ', active' : ''}`,
      );
    });
    markers.forEach((marker, point) => {
      const source = moves.some((move) => move.from === point),
        destination = selectedSequences().some((sequence) => sequence.at(-1)!.to === point);
      marker.visible = source || destination;
      (marker.material as THREE.MeshBasicMaterial).color.set(
        destination ? 0x71e0b1 : selected === point ? 0xffffff : 0xeac678,
      );
      const stack = state.board[point],
        top = stack.at(-1);
      marker.position.y =
        top !== undefined
          ? checkers[top].position.y + heights[owner(top)] + 0.001
          : 0.028 - center.y;
    });
    choices.replaceChildren();
    if (state.phase === 'WAITING_FOR_MOVE' && selected !== null) {
      for (const sequence of selectedSequences().filter((sequence) => sequence.at(-1)!.to === -1)) {
        const button = document.createElement('button');
        button.textContent = `Bear off · ${sequence.map((move) => move.die).join(' + ')}`;
        button.onclick = () => execute(sequence);
        choices.append(button);
      }
    }
    const finished = state.phase === 'GAME_OVER';
    next.hidden = !finished;
    next.textContent = 'New game →';
    canvas.dataset.phase = state.phase;
    canvas.dataset.active = String(state.active);
  }
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  function hit(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    root.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(hitTargets, false)[0]?.object.userData.point as
      | number
      | undefined;
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (game.state.phase !== 'WAITING_FOR_MOVE') return;
    const point = hit(event);
    if (point === undefined) {
      selected = null;
      refresh(false);
      return;
    }
    const moves = game.moves();
    const destinations = selectedSequences().filter((sequence) => sequence.at(-1)!.to === point);
    if (destinations.length) {
      execute(destinations[0]);
      return;
    }
    if (moves.some((move) => move.from === point)) {
      selected = point;
      refresh(false);
    }
  });
  let hovered: number | undefined;
  canvas.addEventListener('pointermove', (event) => {
    const point = game.state.phase === 'WAITING_FOR_MOVE' ? hit(event) : undefined;
    const legal =
      point !== undefined &&
      (game.moves().some((move) => move.from === point) ||
        selectedSequences().some((sequence) => sequence.at(-1)!.to === point));
    canvas.style.cursor = legal ? 'pointer' : 'default';
    if (hovered !== undefined) markers[hovered].scale.setScalar(1);
    hovered = legal ? point : undefined;
    if (hovered !== undefined) markers[hovered].scale.setScalar(1.16);
  });
  undo.addEventListener('click', () => {
    if (game.undo()) {
      selected = null;
      refresh();
    }
  });
  end.addEventListener('click', () => {
    if (game.endTurn()) {
      selected = null;
      refresh();
    }
  });
  next.addEventListener('click', () => {
    game.reset();
    selected = null;
    window.dispatchEvent(new Event('plakoto-reset'));
    refresh();
  });
  refresh();
  return {
    checkerArtwork: assets.map((asset) => asset.scene),
    refresh,
    resize() {
      hitTargets.forEach((hit, point) => {
        hit.position.z = ((point < 12 ? -0.126 : 0.126) - center.z) * layout.depth;
        hit.scale.y = layout.depth;
        markers[point].position.z = (pointPosition(point).z - center.z) * layout.depth;
      });
      if (game.state.phase === 'ANIMATING_MOVE') {
        animationStages = [];
        animations = [];
        game.finishAnimation();
      }
      refresh();
    },
    beginRoll() {
      const ok = game.beginRoll();
      if (ok) refresh(false);
      return ok;
    },
    receiveRoll(values: number[]) {
      game.receiveRoll(values);
      selected = null;
      refresh();
    },
    update(dt: number) {
      if (game.state.phase !== 'ANIMATING_MOVE') return;
      animationTime += dt;
      const t = Math.min(animationTime / (reducedMotion.matches ? 0.02 : 0.32), 1),
        ease = t * t * (3 - 2 * t);
      for (const animation of animations) {
        animation.object.position.lerpVectors(animation.start, animation.end, ease);
        if (animation.moving) animation.object.position.y += Math.sin(t * Math.PI) * 0.045;
      }
      if (t === 1) {
        if (animationStages.length) animateStage(animationStages.shift()!);
        else {
          game.finishAnimation();
          refresh();
        }
      }
    },
  };
}
