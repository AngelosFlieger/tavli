import type { BoardLayout } from './layout';
import { createBoardPresentation } from './board-presentation';
import { createBoardInput } from './board-input';
import { destinationGlow } from './move-glow';
import { createMoveAnimator, prepareAnimationStages } from './move-animation';
import { createMovePreview } from './move-preview';
import * as THREE from 'three';
import { preferences } from '../ui/preferences';
import { createGameplayHud } from '../ui/gameplay-hud';
import { owner, type Move, type Position } from '../game/engine';
import { GameController, type LocalMoveRequest } from '../app/game-controller';
import { pointPosition } from '../game/points';
import { loadModel } from './assets';

export type GameplayHooks = {
  onChange: () => void;
  onMove: (sequence: Move[]) => void;
  onUndo: () => void;
  onRestart: () => void;
};

export async function createGameplay(
  root: THREE.Group,
  center: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  reducedMotion: MediaQueryList,
  layout: BoardLayout,
  controller: GameController,
  hooks: GameplayHooks,
) {
  const seatCamera = camera.position.clone();
  const mine = () => controller.mine();
  let setupTime: number | null = null;
  const locked = () => setupTime !== null || controller.busy;
  const assets = await Promise.all(['Checker_Red', 'Checker_Ivory'].map((name) => loadModel(name)));
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
  const board = createBoardPresentation(center, layout, checkers, heights);
  const preview = createMovePreview(root, camera, checkers, center);
  function updatePresentation() {
    const title = document.body.classList.contains('on-title');
    const waiting = document.body.classList.contains('is-waiting');
    checkers.forEach((checker) => (checker.visible = !title));
    const portrait = matchMedia('(max-aspect-ratio: 1/1)').matches;
    canvas.setAttribute(
      'aria-label',
      waiting
        ? 'Decorative original Plakoto dice and checkers'
        : title && portrait
          ? 'Scattered original Plakoto checkers'
          : title
            ? 'Original Plakoto board without checkers'
            : 'Plakoto board with red and ivory checkers',
    );
  }
  updatePresentation();
  window.addEventListener('resize', updatePresentation);
  const hitTargets: THREE.Mesh[] = [];
  const markers: THREE.Mesh[] = [];
  const columns: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  const mat = new THREE.MeshBasicMaterial({
    color: 0xeac678,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  for (let point = 0; point < 24; point++) {
    const { x, z } = pointPosition(point);
    const hit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.035, 0.245),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    hit.rotation.x = -Math.PI / 2;
    hit.userData.point = point;
    hit.userData.anchor = point < 12 ? -0.126 : 0.126;
    hit.position.set(x - center.x, 0.065 - center.y, hit.userData.anchor - center.z);
    root.add(hit);
    hitTargets.push(hit);
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.0163, 0.018, 40), mat.clone());
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x - center.x, 0.028 - center.y, z - center.z);
    root.add(marker);
    markers.push(marker);
    const column = new THREE.Mesh(new THREE.PlaneGeometry(0.047, 0.19), destinationGlow());
    column.rotation.set(-Math.PI / 2, 0, point < 12 ? Math.PI : 0);
    column.userData.anchor = point < 12 ? -0.1265 : 0.1265;
    column.position.set(x - center.x, 0.0282 - center.y, column.userData.anchor - center.z);
    column.visible = false;
    root.add(column);
    columns.push(column);
  }
  const animator = createMoveAnimator({
    root,
    camera,
    canvas,
    checkers,
    spots: board.spots,
    applySpot: board.applySpot,
    reducedMotion,
    motionEnabled: () => preferences.motion,
  });
  const input = createBoardInput({
    root,
    camera,
    canvas,
    hitTargets,
    markers,
    preview,
    pickup: controller.pickup,
    spots: board.spots,
    state: () => controller.state,
    locked,
    mine,
    onIntent(intent) {
      switch (intent.type) {
        case 'place':
          hooks.onMove(intent.sequence);
          break;
        case 'pickUp':
          controller.pickAt(intent.point);
          refresh(false);
          break;
        case 'releaseLast':
          controller.releaseLastPickup();
          refresh(false);
          break;
        case 'clear':
          controller.clearPickup();
          refresh(false);
          break;
      }
    },
  });
  const hud = createGameplayHud(canvas, controller, locked, {
    undo: hooks.onUndo,
    restart: hooks.onRestart,
    releaseLast() {
      controller.releaseLastPickup();
      refresh(false);
    },
    bearOff: hooks.onMove,
    onChange: hooks.onChange,
  });
  function refresh(updatePositions = true) {
    if (updatePositions && setupTime === null) board.sync(controller.state);
    const state = controller.state;
    const moves = mine() && !locked() ? controller.moves() : [];
    const pickupView = input.refresh();
    const { queue, pickable, sequences } = pickupView;
    markers.forEach((marker, point) => {
      const source =
        moves.some((move) => move.from === point) || (queue.length > 0 && pickable[point] !== null);
      const landed = sequences.filter((sequence) => sequence.at(-1)!.to === point);
      const queuedSource = state.board[point].some((id) => queue.includes(id));
      marker.visible = source || queuedSource;
      const column = columns[point];
      column.visible = landed.length > 0;
      column.material.uniforms.color.value.setHex(
        landed.length > 0 && landed.every((sequence) => sequence.length > 1) ? 0xffb52e : 0x29e1cd,
      );
      (marker.material as THREE.MeshBasicMaterial).color.set(queuedSource ? 0xffd46b : 0xeac678);
      (marker.material as THREE.MeshBasicMaterial).opacity = queuedSource ? 0.35 : 0.7;
      const stack = state.board[point],
        top = stack.at(-1);
      marker.position.z =
        top !== undefined
          ? checkers[top].position.z
          : (pointPosition(point).z - center.z) * layout.depth;
      marker.position.y =
        top !== undefined
          ? checkers[top].position.y + heights[owner(top)] + 0.001
          : 0.028 - center.y;
    });
    hud.render(pickupView);
  }
  refresh();
  return {
    startSetup,
    isSetupActive: () => setupTime !== null,
    playLocalMove(sequence: Move[], request: LocalMoveRequest, done: () => void) {
      animator.start(
        prepareAnimationStages(request.start, request.player, sequence, request.stages),
        request.checker,
        done,
      );
    },
    checkerArtwork: assets.map((asset) => asset.scene),
    refresh,
    faceSeat,
    presentState,
    resize() {
      animator.cancel();
      faceSeat();
      hitTargets.forEach((hit, point) => {
        hit.position.z = (hit.userData.anchor - center.z) * layout.depth;
        hit.scale.y = layout.depth;
        columns[point].position.z = (columns[point].userData.anchor - center.z) * layout.depth;
        columns[point].scale.y = layout.depth;
        markers[point].position.z = (pointPosition(point).z - center.z) * layout.depth;
      });
      refresh();
    },
    update(dt: number) {
      if (!reducedMotion.matches && preferences.motion) preview.update(dt);
      if (setupTime !== null) {
        setupTime += dt;
        board.deal(controller.state, setupTime);
        if (setupTime > 1.75) {
          setupTime = null;
          refresh();
        }
        return;
      }
      animator.update(dt);
    },
    playRemoteMove(sequence: Move[], checker: number, done: () => void) {
      const start: Position = { board: controller.state.board, off: controller.state.off };
      animator.start(
        prepareAnimationStages(start, controller.state.active!, sequence),
        checker,
        done,
      );
      refresh(false);
    },
  };

  function startSetup() {
    if (controller.state.phase !== 'OPENING_ROLL' || controller.state.openingRolls.some(Boolean))
      return;
    if (reducedMotion.matches) {
      setupTime = null;
      refresh();
      return;
    }
    setupTime = 0;
    controller.clearPickup();
    refresh(false);
  }

  /** Look from the same side as our starting stack, so it sits on the near edge. */
  function faceSeat() {
    camera.position.copy(seatCamera);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    root.updateMatrixWorld(true);
    if (controller.seat === null) return;
    const screenY = (point: number) => {
      const { x, z } = pointPosition(point);
      return new THREE.Vector3(x - center.x, 0, (z - center.z) * layout.depth)
        .applyMatrix4(root.matrixWorld)
        .project(camera).y;
    };
    const own = controller.seat === 0 ? 0 : 12;
    if (screenY(own) <= screenY(own === 0 ? 12 : 0)) return;
    camera.position.z *= -1;
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }

  function presentState(resetDice = false) {
    animator.cancel();
    refresh();
    if (resetDice && !document.body.classList.contains('on-title')) startSetup();
  }
}
