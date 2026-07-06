// Device check for @retro-engine/physics-core + physics-rapier (ADR-0148): 2D
// rigid-body dynamics via the Rapier backend. A static floor holds a stack of
// dynamic boxes that fall under gravity; Space drops a new box from the top.
// Units are pixels (gravity −980 px/s²) so the scene reads at the 2D camera's
// default scale. State is published to `window.__physics`.
//
// Open with `?mode=physics`. (Physics steps in the fixed timestep once the Rapier
// wasm finishes loading — the boxes start falling a frame or two after load.)

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { App } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  Query,
  Res,
  Sprite,
  SpritePlugin,
  Transform,
} from '@retro-engine/engine';
import type { CommandsHandle } from '@retro-engine/engine';
import {
  Collider2d,
  Gravity,
  Physics,
  PhysicsPlugin,
  Restitution,
  RigidBody2d,
} from '@retro-engine/physics-core';
import { createRapierBackend } from '@retro-engine/physics-rapier';
import { InputPlugin, KeyboardInput } from '@retro-engine/input';

/** Marker for a falling box. */
class BoxTag {}

interface PhysicsProbe {
  ready: boolean;
  boxes: number;
  lowestY: number;
}

declare global {
  interface Window {
    __physics?: PhysicsProbe;
  }
}

const COLORS: readonly [number, number, number][] = [
  [1, 0.5, 0.4],
  [0.5, 0.9, 1],
  [0.9, 0.8, 0.4],
  [0.6, 1, 0.6],
  [1, 0.6, 0.9],
];

const spawnBox = (cmd: CommandsHandle, x: number, y: number, i: number): void => {
  const c = COLORS[i % COLORS.length]!;
  cmd.spawn(
    new Sprite({ color: vec4.create(c[0], c[1], c[2], 1), customSize: vec2.create(40, 40) }),
    new Transform(vec3.create(x, y, 0)),
    RigidBody2d.dynamic(),
    Collider2d.rectangle(20, 20),
    new Restitution(0.3),
    new BoxTag(),
  );
};

export const physicsShowcasePlugin = (app: App): void => {
  const canvas = document.getElementById('playground-canvas');
  app.addPlugin(new InputPlugin(canvas instanceof HTMLCanvasElement ? { pointerTarget: canvas } : {}));
  app.addPlugin(new SpritePlugin());
  // Pixel-scale gravity so the scene reads at the default 2D camera zoom.
  app.insertResource(new Gravity(vec2.create(0, -980)));
  app.addPlugin(new PhysicsPlugin({ backend: createRapierBackend() }));

  let spawnCount = 0;

  app.addSystem('startup', [Commands], (cmd) => {
    cmd.spawn(...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.06, b: 0.09, a: 1 }) }));
    // Static floor.
    cmd.spawn(
      new Sprite({ color: vec4.create(0.3, 0.32, 0.38, 1), customSize: vec2.create(800, 40) }),
      new Transform(vec3.create(0, -220, 0)),
      RigidBody2d.fixed(),
      Collider2d.rectangle(400, 20),
    );
    // A few boxes to fall on load.
    for (let i = 0; i < 5; i += 1) {
      spawnBox(cmd, (i - 2) * 45, 100 + i * 55, i);
      spawnCount += 1;
    }
  });

  app.addSystem('update', [Commands, Res(KeyboardInput)], (cmd, keys) => {
    if (keys.justPressed('Space')) {
      spawnBox(cmd, (Math.random() - 0.5) * 300, 280, spawnCount);
      spawnCount += 1;
    }
  });

  app.addSystem('last', [Res(Physics), Query([Transform], { with: [BoxTag] })], (physics, boxes) => {
    let lowest = Number.POSITIVE_INFINITY;
    let count = 0;
    for (const [transform] of boxes) {
      count += 1;
      lowest = Math.min(lowest, transform.translation[1] ?? 0);
    }
    window.__physics = {
      ready: physics.ready(),
      boxes: count,
      lowestY: Number.isFinite(lowest) ? Math.round(lowest) : 0,
    };
  });
};
