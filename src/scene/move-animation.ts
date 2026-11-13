import * as THREE from 'three';
import { applyMove, owner, type Move, type Player, type Position } from '../game/engine';
import type { CheckerSpot } from './board-presentation';

export type AnimationStage = { position: Position; pinPoint: number | null };

const PIN_MOVE_SECONDS = 1.5;
const PIN_IMPACT_SECONDS = 0.5;
const PIN_ZOOM = 0.38;

/** Describe each landing before the game or server state is finalized for presentation. */
export function prepareAnimationStages(
  start: Position,
  player: Player,
  sequence: Move[],
  positions?: Position[],
): AnimationStage[] {
  let before = start;
  return sequence.map((move, index) => {
    const destination = move.to < 0 ? [] : before.board[move.to];
    const pinPoint = destination.length === 1 && owner(destination[0]) !== player ? move.to : null;
    const position = positions?.[index] ?? applyMove(before, player, move);
    before = position;
    return { position, pinPoint };
  });
}

type Frame = {
  object: THREE.Group;
  start: THREE.Vector3;
  end: THREE.Vector3;
  moving: boolean;
  fromRotation: THREE.Quaternion;
  toRotation: THREE.Quaternion;
};

type AnimatorOptions = {
  root: THREE.Group;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  checkers: THREE.Group[];
  spots: (position: Position) => Map<number, CheckerSpot>;
  applySpot: (id: number, spot: CheckerSpot) => void;
  reducedMotion: MediaQueryList;
  motionEnabled: () => boolean;
};

/** Owns checker interpolation and pin impact presentation, without changing game state. */
export function createMoveAnimator({
  root,
  camera,
  canvas,
  checkers,
  spots,
  applySpot,
  reducedMotion,
  motionEnabled,
}: AnimatorOptions) {
  let pending: AnimationStage[] = [];
  let frames: Frame[] = [];
  let movingChecker = -1;
  let activePinPoint: number | null = null;
  let animationTime = 0;
  let onComplete: (() => void) | null = null;

  function clearImpact() {
    activePinPoint = null;
    canvas.style.transform = '';
    canvas.style.transformOrigin = '';
    canvas.style.filter = '';
    canvas.style.willChange = '';
  }

  function animateStage(stage: AnimationStage) {
    clearImpact();
    animationTime = 0;
    activePinPoint = stage.pinPoint;
    const destinations = spots(stage.position);
    if (activePinPoint !== null && !reducedMotion.matches && motionEnabled()) {
      root.updateMatrixWorld(true);
      const impact = destinations
        .get(movingChecker)!
        .at.clone()
        .applyMatrix4(root.matrixWorld)
        .project(camera);
      canvas.style.transformOrigin = `${(impact.x + 1) * 50}% ${(1 - impact.y) * 50}%`;
      canvas.style.willChange = 'transform, filter';
    }
    frames = [...destinations].map(([id, spot]) => {
      applySpot(id, spot);
      return {
        object: checkers[id],
        start: checkers[id].position.clone(),
        end: spot.at,
        moving: id === movingChecker,
        fromRotation: checkers[id].quaternion.clone(),
        toRotation: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(spot.flat ? Math.PI / 2 : 0, 0, 0),
        ),
      };
    });
  }

  function cancel() {
    pending = [];
    frames = [];
    onComplete = null;
    clearImpact();
  }

  function start(stages: AnimationStage[], checker: number, done: () => void) {
    cancel();
    if (!stages.length) {
      done();
      return;
    }
    movingChecker = checker;
    onComplete = done;
    pending = stages.slice(1);
    animateStage(stages[0]);
  }

  function update(dt: number) {
    if (!onComplete) return;
    animationTime += dt;
    const impact = activePinPoint !== null && !reducedMotion.matches && motionEnabled();
    const moveDuration = reducedMotion.matches ? 0.02 : impact ? PIN_MOVE_SECONDS : 0.32;
    const impactHold = impact ? PIN_IMPACT_SECONDS : 0;
    const t = Math.min(animationTime / moveDuration, 1),
      ease = impact ? t ** 3.2 : t * t * (3 - 2 * t);
    for (const animation of frames) {
      animation.object.position.lerpVectors(animation.start, animation.end, ease);
      animation.object.quaternion.slerpQuaternions(
        animation.fromRotation,
        animation.toRotation,
        ease,
      );
      if (animation.moving)
        animation.object.position.y += impact
          ? Math.sin(Math.PI * t ** 0.65) * 0.11
          : Math.sin(t * Math.PI) * 0.045;
    }
    if (impact) {
      const focus = Math.max(0, Math.min(1, (t - 0.1) / 0.82));
      const hitTime = Math.max(0, animationTime - moveDuration);
      const fade = Math.max(0, 1 - hitTime / impactHold);
      const release = 1 - fade * fade * (3 - 2 * fade);
      const zoom = 1 + PIN_ZOOM * focus * focus * (3 - 2 * focus) * (1 - release);
      const rumble = Math.min(1, hitTime / 0.04) * fade * fade;
      const shakeX =
        hitTime > 0 ? (Math.sin(hitTime * 115) + 0.4 * Math.sin(hitTime * 251)) * 14 * rumble : 0;
      const shakeY =
        hitTime > 0 ? (Math.cos(hitTime * 147) + 0.35 * Math.sin(hitTime * 307)) * 9 * rumble : 0;
      const flash = hitTime > 0 ? Math.exp(-hitTime * 12) : 0;
      canvas.style.transform = `translate(${shakeX}px, ${shakeY}px) scale(${zoom})`;
      canvas.style.filter = `brightness(${1 + 0.3 * flash}) saturate(${1 + 0.42 * flash})`;
    }
    if (animationTime < moveDuration + impactHold) return;
    clearImpact();
    if (pending.length) animateStage(pending.shift()!);
    else {
      const done = onComplete;
      onComplete = null;
      frames = [];
      done();
    }
  }

  return { start, update, cancel };
}
