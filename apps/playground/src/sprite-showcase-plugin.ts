// Visual harness for Phase 8.1's sprite pipeline (ADR-0031).
//
// Spawns a 4×4 grid of `Sprite`s — half referencing a 16×16 checker image,
// half using the `Images.WHITE` fallback path so each one is a tint-only
// quad. A subset spins on its Z axis each frame to prove the basis-vector
// affine handles rotation; another subset uses `flipX` to verify the UV
// flip path; a few use a `Rect` sub-region to verify atlas-ready UV
// override.

import { quat, vec2, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  Image,
  Images,
  Query,
  Rect,
  ResMut,
  Sprite,
  SpritePlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

/** Marker component: an entity that rotates on its Z axis each frame. */
class Spin {
  constructor(public readonly speed: number = 1.2) {}
}

interface Placement {
  position: readonly [number, number];
  size: readonly [number, number];
  color: readonly [number, number, number, number];
  usesChecker: boolean;
  flipX?: boolean;
  flipY?: boolean;
  rect?: Rect;
  rotates?: boolean;
}

const placements = (): Placement[] => {
  // 4 columns × 4 rows. Cell spacing matches the sprite size so the grid is
  // dense enough to fill the viewport at the default camera scale.
  const cell = (col: number, row: number): [number, number] => [
    (col - 1.5) * 90,
    (row - 1.5) * 90,
  ];
  return [
    { position: cell(0, 0), size: [64, 64], color: [1, 1, 1, 1], usesChecker: true },
    { position: cell(1, 0), size: [64, 64], color: [1, 0.4, 0.4, 1], usesChecker: false },
    { position: cell(2, 0), size: [64, 64], color: [0.4, 1, 0.4, 1], usesChecker: false },
    { position: cell(3, 0), size: [64, 64], color: [0.4, 0.4, 1, 1], usesChecker: false },
    { position: cell(0, 1), size: [64, 64], color: [1, 1, 1, 1], usesChecker: true, flipX: true },
    { position: cell(1, 1), size: [64, 64], color: [1, 0.8, 0.4, 1], usesChecker: true },
    { position: cell(2, 1), size: [64, 64], color: [0.4, 0.8, 1, 1], usesChecker: true, rotates: true },
    { position: cell(3, 1), size: [64, 64], color: [1, 0.4, 0.8, 1], usesChecker: false, rotates: true },
    { position: cell(0, 2), size: [80, 40], color: [1, 1, 1, 1], usesChecker: true },
    { position: cell(1, 2), size: [40, 80], color: [1, 1, 1, 1], usesChecker: true },
    {
      position: cell(2, 2),
      size: [64, 64],
      color: [1, 1, 1, 1],
      usesChecker: true,
      // Bottom-right quarter of the checker.
      rect: new Rect(vec2.create(0.5, 0), vec2.create(1, 0.5)),
    },
    { position: cell(3, 2), size: [64, 64], color: [0.9, 0.9, 0.4, 0.5], usesChecker: true },
    { position: cell(0, 3), size: [64, 64], color: [0.7, 0.4, 1, 1], usesChecker: false, rotates: true },
    { position: cell(1, 3), size: [64, 64], color: [1, 0.7, 0.4, 1], usesChecker: false, flipY: true },
    { position: cell(2, 3), size: [64, 64], color: [0.4, 1, 0.9, 0.7], usesChecker: true },
    { position: cell(3, 3), size: [64, 64], color: [1, 1, 1, 1], usesChecker: true, rotates: true },
  ];
};

/**
 * Playground showcase: spawn a 4×4 grid of sprites that exercises the sprite
 * pipeline's tint / flip / rect / rotation / fallback-image paths. The
 * `Spin`-marked subset rotates on its Z axis each frame to verify the
 * basis-vector affine.
 */
export const spriteShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('sprite-showcase');
  app.addPlugin(new SpritePlugin());

  app.addSystem(
    'startup',
    [Commands, ResMut(Images)],
    (cmd, images) => {
      const checker = images.add(
        Image.checker(
          16,
          vec4.create(0.95, 0.95, 0.95, 1),
          vec4.create(0.25, 0.25, 0.3, 1),
          undefined,
          'sprite-showcase-checker',
        ),
      );

      for (const place of placements()) {
        const components: object[] = [
          new Sprite({
            ...(place.usesChecker ? { image: checker } : {}),
            color: vec4.create(...place.color),
            customSize: vec2.create(place.size[0], place.size[1]),
            ...(place.flipX ? { flipX: true } : {}),
            ...(place.flipY ? { flipY: true } : {}),
            ...(place.rect ? { rect: place.rect } : {}),
          }),
          new Transform(vec3.create(place.position[0], place.position[1], 0)),
        ];
        if (place.rotates) components.push(new Spin());
        cmd.spawn(...components);
      }

      cmd.spawn(
        ...Camera2d({
          clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.07, b: 0.1, a: 1 }),
        }),
      );
      log.info('spawned 16 sprites (8 checker, 8 solid) — 4 rotating, 1 flipped, 1 rect-cropped');
    },
  );

  // Use `.entries()` to get the entity id alongside components so we can
  // bump the Transform change tick after each in-place rotation. The
  // propagation system in `postUpdate` is gated on
  // `Query([Transform], { changed: [Transform] })` — without an explicit
  // `markChanged`, in-place quat mutations stay invisible to it and
  // `GlobalTransform.matrix` never refreshes from the spinning Transform.
  app.addSystem('update', [Query([Transform, Spin]), ResMut(Time)], (rotators, time) => {
    const dt = time.virtual.delta;
    for (const [entity, transform, spin] of rotators.entries()) {
      const delta = quat.create();
      quat.fromAxisAngle(vec3.create(0, 0, 1), spin.speed * dt, delta);
      quat.multiply(delta, transform.rotation, transform.rotation);
      app.world.markChanged(entity, Transform);
    }
  });
};
