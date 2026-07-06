// Device check for @retro-engine/input Phase 1 (ADR-0144): a keyboard/mouse-
// driven sprite. WASD / arrow keys move the white "player" quad; Space snaps it
// back to the origin; holding the left mouse button tints it; the mouse wheel
// scales it. Live state is published to `window.__input` so a probe (or the dev
// console) can confirm the resources are updating without eyeballing pixels.
//
// Open with `?mode=input`.

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { App } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  Query,
  Res,
  Sprite,
  Time,
  Transform,
} from '@retro-engine/engine';
import {
  CursorPosition,
  InputPlugin,
  KeyboardInput,
  MouseButtonInput,
  MouseScroll,
} from '@retro-engine/input';

/** Marker for the input-driven sprite. */
class Player {}

const MOVE_SPEED = 260; // px / second
const MIN_SCALE = 0.4;
const MAX_SCALE = 4;

interface InputProbe {
  x: number;
  y: number;
  scale: number;
  pressed: string[];
  cursor: { x: number; y: number; present: boolean };
}

declare global {
  interface Window {
    __input?: InputProbe;
  }
}

export const inputShowcasePlugin = (app: App): void => {
  // Attach against the playground canvas so cursor coords are canvas-local.
  const canvas = document.getElementById('playground-canvas');
  app.addPlugin(
    new InputPlugin(canvas instanceof HTMLCanvasElement ? { pointerTarget: canvas } : {}),
  );

  app.addSystem('startup', [Commands], (cmd) => {
    cmd.spawn(...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.06, g: 0.07, b: 0.1, a: 1 }) }));
    cmd.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(64, 64) }),
      new Transform(),
      new Player(),
    );
  });

  let scale = 1;

  app.addSystem(
    'update',
    [
      Res(Time),
      Res(KeyboardInput),
      Res(MouseButtonInput),
      Res(MouseScroll),
      Res(CursorPosition),
      Query([Transform, Sprite], { with: [Player] }),
    ],
    (time, keys, mouse, wheel, cursor, players) => {
      const dt = time.virtual.delta;
      let dx = 0;
      let dy = 0;
      if (keys.anyPressed(['KeyA', 'ArrowLeft'])) dx -= 1;
      if (keys.anyPressed(['KeyD', 'ArrowRight'])) dx += 1;
      if (keys.anyPressed(['KeyW', 'ArrowUp'])) dy += 1;
      if (keys.anyPressed(['KeyS', 'ArrowDown'])) dy -= 1;

      // Wheel scales the player; clamp to a sane range.
      if (wheel.y !== 0) {
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - Math.sign(wheel.y) * 0.15));
      }

      const held = mouse.pressed('Left');

      for (const [transform, sprite] of players) {
        const px = transform.translation[0] ?? 0;
        const py = transform.translation[1] ?? 0;
        const pz = transform.translation[2] ?? 0;
        const nx = keys.justPressed('Space') ? 0 : px + dx * MOVE_SPEED * dt;
        const ny = keys.justPressed('Space') ? 0 : py + dy * MOVE_SPEED * dt;
        vec3.set(nx, ny, pz, transform.translation);
        vec3.set(scale, scale, 1, transform.scale);
        // Tint while the left button is held; white otherwise.
        if (held) vec4.set(0.4, 0.9, 1, 1, sprite.color);
        else vec4.set(1, 1, 1, 1, sprite.color);

        window.__input = {
          x: Math.round(nx),
          y: Math.round(ny),
          scale: Number(scale.toFixed(2)),
          pressed: [...keys.getPressed()],
          cursor: { x: Math.round(cursor.x), y: Math.round(cursor.y), present: cursor.present },
        };
      }
    },
  );
};
