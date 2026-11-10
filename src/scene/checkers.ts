import type { BoardLayout } from './layout';
import { destinationGlow, selectedGlow } from './move-glow';
import { trayPosition } from './tray';
import * as THREE from 'three';
import {
  Game,
  applyMove,
  owner,
  moveSequences,
  type GameState,
  type Move,
  type Player,
  type Position,
} from '../game/engine';
import type { Command } from '../net/messages';
import { pointPosition } from '../game/points';
import { loadModel } from './assets';

export type GameplayHooks = {
  onReset: () => void;
  onChange: () => void;
};

export async function createGameplay(
  root: THREE.Group,
  center: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  reducedMotion: MediaQueryList,
  layout: BoardLayout,
  hooks: GameplayHooks,
) {
  const game = new Game();
  const seatCamera = camera.position.clone();
  const roll = document.querySelector<HTMLButtonElement>('#roll')!;
  const undo = document.querySelector<HTMLButtonElement>('#undo')!;
  const message = document.querySelector<HTMLElement>('#game-message')!;
  const choices = document.querySelector<HTMLElement>('#move-choices')!;
  const next = document.querySelector<HTMLButtonElement>('#next-game')!;
  const panels = [
    document.querySelector<HTMLElement>('.player.red')!,
    document.querySelector<HTMLElement>('.player.ivory')!,
  ];
  let online: { you: Player; send: (command: Command) => void } | null = null;
  let remoteCanUndo = false;
  let rollBusy = false;
  let moveBusy = false;
  let remoteAnimation = false;
  let epoch = 0;
  let pendingRoll: { epoch: number; state: GameState; canUndo: boolean } | null = null;
  let remoteResult: { epoch: number; state: GameState; canUndo: boolean } | null = null;
  let selected: number | null = null,
    animationTime = 0;
  const mine = () => !online || online.you === game.state.active;
  let setupTime: number | null = null;
  const locked = () => setupTime !== null || rollBusy || moveBusy || remoteAnimation;
  let animations: {
    object: THREE.Group;
    start: THREE.Vector3;
    end: THREE.Vector3;
    moving: boolean;
    fromRotation: THREE.Quaternion;
    toRotation: THREE.Quaternion;
  }[] = [];
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
    marker.add(selectedGlow());
    root.add(marker);
    markers.push(marker);
    const column = new THREE.Mesh(new THREE.PlaneGeometry(0.047, 0.19), destinationGlow());
    column.rotation.set(-Math.PI / 2, 0, point < 12 ? Math.PI : 0);
    column.position.set(
      x - center.x,
      0.0282 - center.y,
      (point < 12 ? -0.1265 : 0.1265) - center.z,
    );
    column.visible = false;
    root.add(column);
    columns.push(column);
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
        checkers[id].userData.off = false;
        checkers[id].userData.pinned = mixed && index === 0;
        checkers[id].scale.setScalar(mixed && index === 0 ? 1.06 : 1);
      });
    });
    position.off.forEach((ids, player) =>
      ids.forEach((id, index) => {
        const tray = trayPosition(player, index, heights[player] - 0.0004, layout.depth);
        targets.set(
          id,
          new THREE.Vector3(tray.x - center.x, tray.y - center.y, tray.z - center.z * layout.depth),
        );
        checkers[id].userData.off = true;
        checkers[id].scale.setScalar(1);
      }),
    );
    return targets;
  }
  function sync() {
    for (const [id, pos] of positions()) {
      checkers[id].position.copy(pos);
      checkers[id].rotation.set(checkers[id].userData.off ? Math.PI / 2 : 0, 0, 0);
    }
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
      fromRotation: checkers[id].quaternion.clone(),
      toRotation: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(checkers[id].userData.off ? Math.PI / 2 : 0, 0, 0),
      ),
    }));
  }
  function execute(sequence: Move[]) {
    if (online) {
      if (!mine() || locked() || game.state.phase !== 'WAITING_FOR_MOVE') return;
      moveBusy = true;
      online.send({ type: 'move', sequence });
      selected = null;
      refresh(false);
      return;
    }
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
    if (updatePositions && setupTime === null) sync();
    const state = game.state;
    const moves = mine() && !locked() ? game.moves() : [];
    roll.disabled =
      locked() ||
      !mine() ||
      !['OPENING_ROLL', 'WAITING_FOR_ROLL', 'TURN_COMPLETE'].includes(state.phase);
    undo.disabled =
      locked() ||
      !mine() ||
      !['WAITING_FOR_MOVE', 'TURN_COMPLETE'].includes(state.phase) ||
      (online ? !remoteCanUndo : !game.history.length);
    const ending = state.phase === 'TURN_COMPLETE';
    roll.classList.toggle('end-action', ending);
    roll.dataset.action = ending ? 'end' : 'roll';
    roll.innerHTML = ending ? 'END <span>→</span>' : 'ROLL <span>↗</span>';
    message.textContent = state.message;
    message.hidden = state.phase !== 'GAME_OVER';
    roll.setAttribute(
      'aria-label',
      ending ? 'End turn' : state.opening ? `Player ${state.active! + 1} opening roll` : 'Roll',
    );
    hooks.onChange();
    if (selected !== null && !moves.some((move) => move.from === selected)) selected = null;
    panels.forEach((panel, player) => {
      panel.classList.toggle('inactive', state.active !== null && state.active !== player);
      panel.classList.toggle('active', state.active === player && state.phase !== 'GAME_OVER');
      panel.classList.toggle('you', online?.you === player);
      panel.setAttribute(
        'aria-label',
        `Player ${player + 1}${state.active === player ? ', active' : ''}${online?.you === player ? ', you' : ''}`,
      );
    });
    markers.forEach((marker, point) => {
      const source = moves.some((move) => move.from === point),
        destination = selectedSequences().some((sequence) => sequence.at(-1)!.to === point);
      marker.visible = selected === null ? source : selected === point;
      const sequences = selectedSequences().filter((sequence) => sequence.at(-1)!.to === point);
      const combined = sequences.length > 0 && sequences.every((sequence) => sequence.length > 1);
      const column = columns[point];
      column.visible = destination;
      const color = combined ? 0xffb52e : 0x29e1cd;
      column.material.uniforms.color.value.setHex(color);
      marker.children[0].visible = selected === point;
      (marker.material as THREE.MeshBasicMaterial).color.set(
        selected === point ? 0xffd46b : 0xeac678,
      );
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
    choices.replaceChildren();
    if (state.phase === 'WAITING_FOR_MOVE' && selected !== null) {
      for (const sequence of selectedSequences().filter((sequence) => sequence.at(-1)!.to === -1)) {
        const button = document.createElement('button');
        button.textContent = `Bear off · ${sequence.map((move) => move.die).join(' + ')}`;
        button.onclick = () => execute(sequence);
        choices.append(button);
      }
    }
    next.hidden = state.phase !== 'GAME_OVER';
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
    if (locked() || !mine() || game.state.phase !== 'WAITING_FOR_MOVE') return;
    const point = hit(event);
    if (point === undefined) {
      selected = null;
      refresh(false);
      return;
    }
    if (selected === point) {
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
    const point =
      game.state.phase === 'WAITING_FOR_MOVE' && mine() && !locked() ? hit(event) : undefined;
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
    if (online) {
      if (mine() && !locked()) online.send({ type: 'undo' });
      return;
    }
    if (game.undo()) {
      selected = null;
      refresh();
    }
  });
  roll.addEventListener('click', (event) => {
    if (game.state.phase !== 'TURN_COMPLETE') return;
    // Ending must not fall through to the dice handler after refresh switches the label.
    event.stopImmediatePropagation();
    if (locked() || !mine()) return;
    if (online) {
      if (mine() && !locked()) online.send({ type: 'end' });
      return;
    }
    if (game.endTurn()) {
      selected = null;
      refresh();
    }
  });
  function restart() {
    if (!canRestart()) return;
    if (online) {
      online.send({ type: 'restart' });
      return;
    }
    game.reset();
    selected = null;
    startSetup();
    hooks.onReset();
    refresh();
  }
  function canRestart() {
    return !locked() && game.state.phase !== 'ROLLING' && game.state.phase !== 'ANIMATING_MOVE';
  }
  next.addEventListener('click', restart);
  refresh();
  return {
    restart,
    startSetup,
    canRestart,
    checkerArtwork: assets.map((asset) => asset.scene),
    refresh,
    resize() {
      faceSeat();
      hitTargets.forEach((hit, point) => {
        hit.position.z = ((point < 12 ? -0.126 : 0.126) - center.z) * layout.depth;
        hit.scale.y = layout.depth;
        columns[point].position.z = ((point < 12 ? -0.1265 : 0.1265) - center.z) * layout.depth;
        columns[point].scale.y = layout.depth;
        markers[point].position.z = (pointPosition(point).z - center.z) * layout.depth;
      });
      if (remoteResult && remoteResult.epoch === epoch) {
        const result = remoteResult;
        remoteResult = null;
        remoteAnimation = false;
        animationStages = [];
        animations = [];
        adopt(result.state, result.canUndo);
      } else if (game.state.phase === 'ANIMATING_MOVE') {
        animationStages = [];
        animations = [];
        game.finishAnimation();
      }
      refresh();
    },
    beginRoll() {
      if (locked()) return false;
      if (online) {
        if (locked() || !mine()) return false;
        if (!['OPENING_ROLL', 'WAITING_FOR_ROLL'].includes(game.state.phase)) return false;
        rollBusy = true;
        online.send({ type: 'roll' });
        refresh(false);
        return true;
      }
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
      if (setupTime !== null) {
        setupTime += dt;
        const targets = positions();
        checkers.forEach((checker, id) => {
          const player = owner(id),
            index = id % 15;
          const tray = trayPosition(player, index, heights[player] - 0.0004, layout.depth, 'start');
          const t = Math.min(1, Math.max(0, (setupTime! - 0.25 - index * 0.045) / 0.82));
          const ease = t * t * (3 - 2 * t);
          checker.position
            .set(tray.x - center.x, tray.y - center.y, tray.z - center.z * layout.depth)
            .lerp(targets.get(id)!, ease);
          checker.position.y += Math.sin(t * Math.PI) * 0.07;
          checker.rotation.set(
            ((1 - ease) * Math.PI) / 2,
            Math.sin(t * Math.PI) * (player ? -0.16 : 0.16),
            0,
          );
        });
        if (setupTime > 1.75) {
          setupTime = null;
          refresh();
        }
        return;
      }
      if (game.state.phase !== 'ANIMATING_MOVE' && !remoteAnimation) return;
      animationTime += dt;
      const t = Math.min(animationTime / (reducedMotion.matches ? 0.02 : 0.32), 1),
        ease = t * t * (3 - 2 * t);
      for (const animation of animations) {
        animation.object.position.lerpVectors(animation.start, animation.end, ease);
        animation.object.quaternion.slerpQuaternions(
          animation.fromRotation,
          animation.toRotation,
          ease,
        );
        if (animation.moving) animation.object.position.y += Math.sin(t * Math.PI) * 0.045;
      }
      if (t === 1) {
        if (animationStages.length) animateStage(animationStages.shift()!);
        else if (remoteAnimation) finishRemote();
        else {
          game.finishAnimation();
          refresh();
        }
      }
    },
    throwingPlayer: () => (game.state.active ?? 0) as Player,
    scripted: () => online !== null,
    presented() {
      const result = pendingRoll;
      pendingRoll = null;
      if (!result || result.epoch !== epoch) return;
      adopt(result.state, result.canUndo);
    },
    queueRoll(state: GameState, canUndo: boolean) {
      pendingRoll = { epoch, state, canUndo };
    },
    animateMove(sequence: Move[], state: GameState, canUndo: boolean) {
      moveBusy = false;
      const checker = game.state.board[sequence[0]?.from]?.at(-1);
      if (checker === undefined) {
        adopt(state, canUndo);
        return;
      }
      movingChecker = checker;
      let position: Position = { board: game.state.board, off: game.state.off };
      const stages: Position[] = [];
      for (const move of sequence) {
        position = applyMove(position, game.state.active!, move);
        stages.push(position);
      }
      remoteResult = { epoch, state, canUndo };
      remoteAnimation = true;
      selected = null;
      animationStages = stages;
      animateStage(animationStages.shift()!);
      refresh(false);
    },
    applyRemote: adopt,
    join(you: Player, send: (command: Command) => void) {
      online = { you, send };
      remoteCanUndo = false;
      faceSeat();
    },
    leaveOnline() {
      online = null;
      faceSeat();
      adopt(new Game().state, false, true);
    },
  };

  function startSetup() {
    if (game.state.phase !== 'OPENING_ROLL' || game.state.openingRolls.some(Boolean)) return;
    if (reducedMotion.matches) {
      setupTime = null;
      refresh();
      return;
    }
    setupTime = 0;
    selected = null;
    refresh(false);
  }

  /** Look from the same side as our starting stack, so it sits on the near edge. */
  function faceSeat() {
    camera.position.copy(seatCamera);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    root.updateMatrixWorld(true);
    let flipped = false;
    if (online) {
      const screenY = (point: number) => {
        const { x, z } = pointPosition(point);
        return new THREE.Vector3(x - center.x, 0, (z - center.z) * layout.depth)
          .applyMatrix4(root.matrixWorld)
          .project(camera).y;
      };
      const own = online.you === 0 ? 0 : 12;
      const theirs = own === 0 ? 12 : 0;
      flipped = screenY(own) > screenY(theirs);
      if (flipped) {
        camera.position.z *= -1;
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
      }
    }
  }

  function finishRemote() {
    const result = remoteResult;
    remoteResult = null;
    remoteAnimation = false;
    animationStages = [];
    animations = [];
    if (!result || result.epoch !== epoch) return;
    adopt(result.state, result.canUndo);
  }

  function adopt(state: GameState, canUndo: boolean, resetDice = false) {
    epoch++;
    pendingRoll = null;
    remoteResult = null;
    remoteAnimation = false;
    rollBusy = false;
    moveBusy = false;
    animationStages = [];
    animations = [];
    remoteCanUndo = canUndo;
    game.history = [];
    game.state = structuredClone(state);
    selected = null;
    sequenceCacheKey = '';
    if (resetDice) hooks.onReset();
    refresh();
    if (resetDice && !document.body.classList.contains('on-title')) startSetup();
  }
}
