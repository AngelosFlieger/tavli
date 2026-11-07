import { Body, Box, ContactMaterial, Cylinder, Material, Vec3, World } from 'cannon-es';

/** Colliders follow the original board's felt, frame and tray dimensions. */
export function createHomeWorld(center: { x: number; y: number; z: number }, scale: number) {
  const world = new World({ gravity: new Vec3(0, -9.81, 0), allowSleep: true });
  const wood = new Material('board'),
    checker = new Material('checker');
  world.addContactMaterial(
    new ContactMaterial(wood, checker, { friction: 0.55, restitution: 0.22 }),
  );
  world.addContactMaterial(
    new ContactMaterial(checker, checker, { friction: 0.5, restitution: 0.16 }),
  );
  const board = new Body({ mass: 0, material: wood });
  function box(x: number, y: number, z: number, w: number, h: number, d: number) {
    board.addShape(
      new Box(new Vec3((w * scale) / 2, (h * scale) / 2, (d * scale) / 2)),
      new Vec3((x - center.x) * scale, (y - center.y) * scale, (z - center.z) * scale),
    );
  }
  for (const side of [-1, 1]) {
    box(side * 0.162, 0.017, 0, 0.307, 0.016, 0.47);
    box(side * 0.139, 0.026, 0, 0.218, 0.003, 0.414);
    for (const end of [-1, 1]) box(side * 0.162, 0.031, end * 0.219, 0.3, 0.019, 0.025);
    box(side * 0.009, 0.031, 0, 0.014, 0.019, 0.42);
    box(side * 0.308, 0.031, 0, 0.015, 0.019, 0.424);
    box(side * 0.258, 0.03, 0, 0.009, 0.016, 0.422);
  }
  world.addBody(board);
  return {
    world,
    checker(radius: number, height: number) {
      const body = new Body({
        mass: 0.035,
        material: checker,
        shape: new Cylinder(radius, radius, height, 16),
        linearDamping: 0.12,
        angularDamping: 0.3,
        sleepSpeedLimit: 0.12,
        sleepTimeLimit: 0.8,
      });
      world.addBody(body);
      return body;
    },
  };
}
