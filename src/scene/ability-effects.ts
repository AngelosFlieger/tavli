import * as THREE from 'three';
import type { GameState } from '../game/session/state';

type EffectVisual = THREE.Group & {
  userData: { abilityId: 'frostSeal' | 'bastion'; point: number; checker: number };
};

export type BoardAbilityEffect = {
  instanceId: string;
  abilityId: 'frostSeal' | 'bastion';
  point: number;
  checker: number;
};

export function boardAbilityEffects(state: GameState): BoardAbilityEffect[] {
  return (state.powerups?.activeEffects ?? []).flatMap((effect) => {
    if (
      (effect.abilityId !== 'frostSeal' && effect.abilityId !== 'bastion') ||
      effect.target.type !== 'POINT'
    )
      return [];
    const stack = state.board[effect.target.point];
    const top = stack.at(-1);
    const checker =
      effect.abilityId === 'bastion' &&
      effect.modifiers.anchorChecker !== undefined &&
      stack.includes(effect.modifiers.anchorChecker)
        ? effect.modifiers.anchorChecker
        : top;
    return checker === undefined
      ? []
      : [
          {
            instanceId: effect.instanceId,
            abilityId: effect.abilityId,
            point: effect.target.point,
            checker,
          },
        ];
  });
}

/** Temporary, presentation-only board explanations for public point effects. */
export function createAbilityEffects(
  root: THREE.Group,
  checkers: THREE.Group[],
  heights: number[],
) {
  const visuals = new Map<string, EffectVisual>();

  function sync(state: GameState) {
    const visible = new Set<string>();
    const effects = boardAbilityEffects(state);
    for (const effect of effects) {
      const { point, checker } = effect;
      visible.add(effect.instanceId);
      let visual = visuals.get(effect.instanceId);
      if (
        !visual ||
        visual.userData.checker !== checker ||
        visual.userData.abilityId !== effect.abilityId
      ) {
        if (visual) removeVisual(effect.instanceId, visual);
        visual =
          effect.abilityId === 'bastion'
            ? bastionVisual(point, checker)
            : frostVisual(point, checker);
        visuals.set(effect.instanceId, visual);
        root.add(visual);
      }
      visual.position.copy(checkers[checker].position);
      visual.rotation.copy(checkers[checker].rotation);
    }
    for (const [instanceId, visual] of visuals)
      if (!visible.has(instanceId)) removeVisual(instanceId, visual);
    return effects;
  }

  function bastionVisual(point: number, checker: number): EffectVisual {
    const group = new THREE.Group() as EffectVisual;
    group.userData = { abilityId: 'bastion', point, checker };
    const ghost = checkers[checker].clone(true);
    ghost.position.set(0, 0.002, point < 12 ? -0.038 : 0.038);
    ghost.rotation.set(0, 0, 0);
    makeGhost(ghost, 0x7ceee4, 0.3);
    const shield = iconSprite('shield', '#8ff5e8');
    shield.position.set(0, heights[Math.floor(checker / 15)] + 0.034, ghost.position.z);
    shield.userData.baseY = shield.position.y;
    group.add(ghost, shield);
    return group;
  }

  function frostVisual(point: number, checker: number): EffectVisual {
    const group = new THREE.Group() as EffectVisual;
    group.userData = { abilityId: 'frostSeal', point, checker };
    const height = heights[Math.floor(checker / 15)] * 1.8;
    const ice = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, height, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x79bfff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ice.position.y = height / 2;
    const snow = iconSprite('snow', '#a9d8ff');
    snow.position.set(0, height + 0.027, point < 12 ? -0.004 : 0.004);
    snow.userData.baseY = snow.position.y;
    group.add(ice, snow);
    return group;
  }

  function update(elapsed: number) {
    for (const visual of visuals.values()) {
      const offset = visual.userData.point * 0.37;
      const pulse = 1 + Math.sin(elapsed * 3.2 + offset) * 0.045;
      visual.scale.setScalar(pulse);
      const sprite = visual.children.find((child) => child instanceof THREE.Sprite);
      if (sprite)
        sprite.position.y =
          Number(sprite.userData.baseY) + Math.sin(elapsed * 2.4 + offset) * 0.002;
    }
  }

  function removeVisual(instanceId: string, visual: EffectVisual) {
    root.remove(visual);
    visual.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.SpriteMaterial) material.map?.dispose();
        material.dispose();
      }
    });
    visuals.delete(instanceId);
  }

  return { sync, update };
}

function makeGhost(root: THREE.Object3D, color: number, opacity: number): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const materials = source.map((material) => {
      const clone = material.clone();
      clone.transparent = true;
      clone.opacity = opacity;
      clone.depthWrite = false;
      if ('color' in clone && clone.color instanceof THREE.Color)
        clone.color.lerp(new THREE.Color(color), 0.65);
      return clone;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
}

function iconSprite(kind: 'shield' | 'snow', color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, 128, 128);
  context.strokeStyle = color;
  context.fillStyle = `${color}33`;
  context.lineWidth = 9;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (kind === 'shield') {
    context.beginPath();
    context.moveTo(64, 13);
    context.lineTo(105, 31);
    context.lineTo(99, 76);
    context.quadraticCurveTo(92, 102, 64, 116);
    context.quadraticCurveTo(36, 102, 29, 76);
    context.lineTo(23, 31);
    context.closePath();
    context.fill();
    context.stroke();
  } else {
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 3) {
      context.beginPath();
      context.moveTo(64 + Math.cos(angle) * 49, 64 + Math.sin(angle) * 49);
      context.lineTo(64 - Math.cos(angle) * 49, 64 - Math.sin(angle) * 49);
      context.stroke();
    }
    context.beginPath();
    context.arc(64, 64, 9, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.036, 0.036, 1);
  sprite.renderOrder = 8;
  return sprite;
}
