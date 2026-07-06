// Visual harness for the engine MSDF text pipeline (ADR-0149).
//
// Uses the built-in, zero-dependency SDF default font (`installDefaultFont`) —
// no font asset on disk — and spawns several `Text2d` entities that exercise the
// text path: multi-line (`\n`), word wrap at a `maxWidth`, left/center/right
// alignment, tint colour, varied `fontSize`, and a spinning label to prove the
// glyph quads follow the entity transform. Renders through the transparent 2D
// phase like sprites.

import { quat, vec2, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  installDefaultFont,
  Query,
  ResMut,
  Text2d,
  TextPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

/** Marker: an entity that rotates on its Z axis each frame. */
class Spin {
  constructor(public readonly speed: number = 0.8) {}
}

/**
 * Playground showcase: draw multi-line, wrapped, and aligned `Text2d` using the
 * built-in default font, plus one rotating label.
 */
export const textShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('text-showcase');
  app.addPlugin(new TextPlugin());
  const font = installDefaultFont(app);

  app.addSystem(
    'startup',
    [Commands],
    (cmd) => {
      // Title, top-centre.
      cmd.spawn(
        new Text2d({ text: 'RETRO ENGINE', font, fontSize: 64, color: vec4.create(1, 1, 1, 1), anchor: vec2.create(0.5, 0.5) }),
        new Transform(vec3.create(0, 220, 0)),
      );

      // Multi-line block, left-aligned.
      cmd.spawn(
        new Text2d({
          text: 'MSDF TEXT\nCRISP AT ANY\nSCALE 123!',
          font,
          fontSize: 40,
          color: vec4.create(0.95, 0.85, 0.3, 1),
          align: 'left',
          anchor: vec2.create(0, 0),
        }),
        new Transform(vec3.create(-360, 120, 0)),
      );

      // Word-wrapped paragraph, centre-aligned.
      cmd.spawn(
        new Text2d({
          text: 'The quick brown fox jumps over the lazy dog while five wizards vex.',
          font,
          fontSize: 26,
          color: vec4.create(0.5, 0.85, 1, 1),
          align: 'center',
          maxWidth: 420,
          anchor: vec2.create(0.5, 0),
        }),
        new Transform(vec3.create(120, 60, 0)),
      );

      // Right-aligned tinted lines.
      cmd.spawn(
        new Text2d({
          text: 'SCORE: 42000\nLIVES: 3',
          font,
          fontSize: 32,
          color: vec4.create(1, 0.4, 0.4, 1),
          align: 'right',
          anchor: vec2.create(1, 1),
        }),
        new Transform(vec3.create(380, -140, 0)),
      );

      // Spinning label.
      cmd.spawn(
        new Text2d({ text: 'SPIN!', font, fontSize: 48, color: vec4.create(0.6, 1, 0.6, 1) }),
        new Transform(vec3.create(-260, -180, 0)),
        new Spin(),
      );

      cmd.spawn(
        ...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.04, g: 0.05, b: 0.09, a: 1 }) }),
      );
      log.info('spawned 5 Text2d blocks (title, multi-line, wrapped, right-aligned HUD, spinner) using the built-in default font');
    },
    { label: 'text-showcase-setup' },
  );

  app.addSystem(
    'update',
    [Query([Transform, Spin]), ResMut(Time)],
    (spinners, time) => {
      const dt = time.virtual.delta;
      for (const [entity, transform, spin] of spinners.entries()) {
        const delta = quat.create();
        quat.fromAxisAngle(vec3.create(0, 0, 1), spin.speed * dt, delta);
        quat.multiply(delta, transform.rotation, transform.rotation);
        app.world.markChanged(entity, Transform);
      }
    },
    { label: 'text-showcase-spin' },
  );
};
