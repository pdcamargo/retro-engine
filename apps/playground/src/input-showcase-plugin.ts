// Device check for @retro-engine/input (ADR-0144/0145/0146): a sprite driven
// through the action map. The `Move` axis2d (WASD / arrows) moves the white
// "player" quad; the `Reset` button snaps it to the origin; `Fire` (left mouse
// or F) tints it; the mouse wheel scales it via the raw `MouseScroll` resource.
// A connected gamepad's left stick also moves the player and `South` (A) fires.
// Press R to rebind `Reset` between Space and Enter at runtime (mutating the
// serialized `ActionMap`). Live state is published to `window.__input` so a probe
// or the dev console can confirm resolution without eyeballing pixels.
//
// Open with `?mode=input`.

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { App } from '@retro-engine/engine';
import { Camera2d, ClearColorConfig, Commands, Query, Res, Sprite, Transform } from '@retro-engine/engine';
import {
  ActionMap,
  ActionState,
  Gamepads,
  InputPlugin,
  KeyboardInput,
  MouseScroll,
  key,
  mouseButton,
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
  move: { x: number; y: number };
  fire: boolean;
  resetKey: string;
  gamepad: { connected: boolean; x: number; y: number; south: boolean };
}

declare global {
  interface Window {
    __input?: InputProbe;
  }
}

const buildMap = (resetKey: 'Space' | 'Enter'): ActionMap =>
  new ActionMap()
    .axis2d('Move', { left: key('KeyA'), right: key('KeyD'), up: key('KeyW'), down: key('KeyS') })
    .axis2d('MoveArrows', {
      left: key('ArrowLeft'),
      right: key('ArrowRight'),
      up: key('ArrowUp'),
      down: key('ArrowDown'),
    })
    .button('Reset', key(resetKey))
    .button('Fire', key('KeyF'), mouseButton('Left'));

export const inputShowcasePlugin = (app: App): void => {
  const canvas = document.getElementById('playground-canvas');
  app.addPlugin(
    new InputPlugin(canvas instanceof HTMLCanvasElement ? { pointerTarget: canvas } : {}),
  );

  app.addSystem('startup', [Commands], (cmd) => {
    cmd.spawn(...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.06, g: 0.07, b: 0.1, a: 1 }) }));
    // ActionState is auto-attached (Required Component of ActionMap).
    cmd.spawn(
      new Sprite({ color: vec4.create(1, 1, 1, 1), customSize: vec2.create(64, 64) }),
      new Transform(),
      new Player(),
      buildMap('Space'),
    );
  });

  let scale = 1;
  let resetKey: 'Space' | 'Enter' = 'Space';

  app.addSystem(
    'update',
    [
      Res(KeyboardInput),
      Res(MouseScroll),
      Res(Gamepads),
      Query([Transform, Sprite, ActionState, ActionMap], { with: [Player] }),
    ],
    (keys, wheel, gamepads, players) => {
      // Runtime rebind demo: R toggles the Reset binding by rewriting the map.
      const rebind = keys.justPressed('KeyR');

      if (wheel.y !== 0) {
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - Math.sign(wheel.y) * 0.15));
      }

      // Fold in the first connected gamepad's left stick + South button.
      const pad = gamepads.first();
      const gx = pad?.axes.getOrZero('LeftStickX') ?? 0;
      const gy = pad?.axes.getOrZero('LeftStickY') ?? 0;
      const gSouth = pad?.buttons.pressed('South') ?? false;

      for (const [transform, sprite, actions, map] of players) {
        if (rebind) {
          resetKey = resetKey === 'Space' ? 'Enter' : 'Space';
          const reset = map.get('Reset');
          if (reset) reset.bindings = buildMap(resetKey).get('Reset')!.bindings;
        }

        // Sum both D-pads and the gamepad stick so any device moves the player.
        const a = actions.axis2d('Move');
        const b = actions.axis2d('MoveArrows');
        const dx = Math.max(-1, Math.min(1, a.x + b.x + gx));
        const dy = Math.max(-1, Math.min(1, a.y + b.y + gy));

        const px = transform.translation[0] ?? 0;
        const py = transform.translation[1] ?? 0;
        const pz = transform.translation[2] ?? 0;
        const doReset = actions.justPressed('Reset');
        const nx = doReset ? 0 : px + dx * MOVE_SPEED * (1 / 60);
        const ny = doReset ? 0 : py + dy * MOVE_SPEED * (1 / 60);
        vec3.set(nx, ny, pz, transform.translation);
        vec3.set(scale, scale, 1, transform.scale);

        const fire = actions.pressed('Fire') || gSouth;
        if (fire) vec4.set(0.4, 0.9, 1, 1, sprite.color);
        else vec4.set(1, 1, 1, 1, sprite.color);

        window.__input = {
          x: Math.round(nx),
          y: Math.round(ny),
          scale: Number(scale.toFixed(2)),
          move: { x: dx, y: dy },
          fire,
          resetKey,
          gamepad: {
            connected: pad !== undefined,
            x: Number(gx.toFixed(2)),
            y: Number(gy.toFixed(2)),
            south: gSouth,
          },
        };
      }
    },
  );
};
