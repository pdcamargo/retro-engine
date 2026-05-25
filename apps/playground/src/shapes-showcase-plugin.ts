// Phase 8.7 visual-verification harness: spawn arbitrary 2D geometry through
// `Material2d` + `Mesh2d` + `ColorMaterial2d`.
//
// Three groups of shapes share one `Camera2d`:
//
// - 4×4 grid of opaque shapes (Rectangle / Circle / RegularPolygon) at
//   varying hues. Demonstrates the plain `Material2d → Opaque2d` path.
// - Two blend-mode columns (alpha < 1, `alphaMode: 'blend'`) that overlap
//   each other and the grid. Exercises the `Transparent2d` path.
// - One mask-mode shape (alpha just below the 0.5 cutoff in some pixels via
//   a sub-1 color.a value) — visually a hard-edged disc, demonstrates the
//   previously-empty `AlphaMask2d` slot lighting up.
// - Z-parallax sub-scene: three overlapping squares at Z=-10 / 0 / 10.
//   With the Phase 8.7 Core2d sort fix the Z=-10 square draws last (on top
//   of Z=0, on top of Z=10); pre-fix the order would have been reversed.
//
// Spawn with `?mode=shapes`.
//
// Note: per ADR-0035 §"Bind-group convention", Material2d's bind-group
// layout matches Material3d byte-for-byte — the playground is unaware of
// the layout, this comment is here for any future maintainer reading the
// showcase for context.

import { quat, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  Camera2d,
  Circle,
  ColorMaterial2d,
  ColorMaterial2dPlugin,
  Commands,
  Material2dPlugin,
  type Meshable,
  Mesh2d,
  Meshes,
  Rectangle,
  RegularPolygon,
  ResMut,
  Transform,
} from '@retro-engine/engine';

interface Placement {
  meshable: Meshable;
  position: readonly [number, number, number];
  color: readonly [number, number, number, number];
  alphaMode?: 'blend' | { kind: 'mask'; cutoff: number };
}

const gridPlacements = (): Placement[] => {
  // 4×4 grid of opaque shapes, centered on the origin. Cell spacing 80
  // (pixels — Camera2d default ortho is 1 world unit per pixel via
  // `scalingMode: WindowSize`).
  const cell = (col: number, row: number): [number, number, number] => [
    (col - 1.5) * 80,
    (row - 1.5) * 80,
    0,
  ];
  const swatches: readonly (readonly [number, number, number, number])[] = [
    [0.95, 0.55, 0.45, 1],
    [0.55, 0.85, 0.6, 1],
    [0.45, 0.7, 0.95, 1],
    [0.95, 0.85, 0.4, 1],
    [0.85, 0.45, 0.85, 1],
    [0.45, 0.95, 0.9, 1],
    [0.6, 0.6, 0.95, 1],
    [0.95, 0.7, 0.35, 1],
    [0.5, 0.95, 0.5, 1],
    [0.95, 0.5, 0.55, 1],
    [0.8, 0.4, 0.4, 1],
    [0.4, 0.8, 0.4, 1],
    [0.4, 0.6, 0.95, 1],
    [0.95, 0.85, 0.5, 1],
    [0.85, 0.55, 0.9, 1],
    [0.5, 0.95, 0.85, 1],
  ];
  const places: Placement[] = [];
  let i = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const swatch = swatches[i]!;
      const which = i % 3;
      const meshable: Meshable =
        which === 0
          ? new Rectangle({ halfSize: [30, 22] })
          : which === 1
            ? new Circle({ radius: 28 })
            : new RegularPolygon({ circumradius: 30, sides: 5 + (i % 3) });
      places.push({ meshable, position: cell(col, row), color: swatch });
      i++;
    }
  }
  return places;
};

const blendOverlayPlacements = (): Placement[] => {
  // Two translucent squares offset from the grid corners. They overlap each
  // other and the grid, so the Transparent2d pass actually has to composite
  // back-to-front.
  return [
    {
      meshable: new Rectangle({ halfSize: [100, 60] }),
      position: [-150, 120, 0],
      color: [0.2, 0.5, 1.0, 0.5],
      alphaMode: 'blend',
    },
    {
      meshable: new Rectangle({ halfSize: [100, 60] }),
      position: [150, -120, 0],
      color: [1.0, 0.4, 0.2, 0.5],
      alphaMode: 'blend',
    },
  ];
};

const maskPlacement = (): Placement => ({
  meshable: new Circle({ radius: 40 }),
  position: [0, 200, 0],
  // alpha = 0.6 ≥ cutoff 0.5 ⇒ the disc renders. (A swap to 0.4 would
  // discard every fragment — the disc would vanish, proving the discard
  // path is engaged.)
  color: [1.0, 0.9, 0.4, 0.6],
  alphaMode: { kind: 'mask', cutoff: 0.5 },
});

const parallaxPlacements = (): Placement[] => {
  // Three overlapping rectangles in the bottom-right quadrant, each offset
  // slightly so the layering is visible. Z=-10 is nearest to the camera and
  // should draw last; Z=10 is farthest and should draw first.
  const baseX = 200;
  const baseY = -200;
  return [
    {
      meshable: new Rectangle({ halfSize: [70, 70] }),
      position: [baseX - 30, baseY + 30, 10],
      color: [0.3, 0.3, 0.9, 1],
    },
    {
      meshable: new Rectangle({ halfSize: [70, 70] }),
      position: [baseX, baseY, 0],
      color: [0.3, 0.9, 0.3, 1],
    },
    {
      meshable: new Rectangle({ halfSize: [70, 70] }),
      position: [baseX + 30, baseY - 30, -10],
      color: [0.9, 0.3, 0.3, 1],
    },
  ];
};

/**
 * Playground showcase: spawn ~22 `Mesh2d + MeshMaterial2d<ColorMaterial2d>`
 * entities driving the three Phase 8.7 paths (opaque / blend / mask) plus a
 * Z-parallax sub-scene that exercises the Core2d back-to-front sort fix.
 */
export const shapesShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('shapes-showcase');
  const colorPlugin = new Material2dPlugin(ColorMaterial2d);
  app.addPlugin(new ColorMaterial2dPlugin());
  app.addPlugin(colorPlugin);

  app.addSystem(
    'startup',
    [Commands, ResMut(Meshes), ResMut(colorPlugin.Materials2d)],
    (cmd, meshes, materials) => {
      const all: Placement[] = [
        ...gridPlacements(),
        ...blendOverlayPlacements(),
        maskPlacement(),
        ...parallaxPlacements(),
      ];

      for (const place of all) {
        const meshHandle = meshes.add(place.meshable.mesh().build());
        const init: { color: ReturnType<typeof vec4.create>; alphaMode?: 'blend' | { kind: 'mask'; cutoff: number } } = {
          color: vec4.create(place.color[0], place.color[1], place.color[2], place.color[3]),
        };
        if (place.alphaMode !== undefined) init.alphaMode = place.alphaMode;
        const materialHandle = materials.add(new ColorMaterial2d(init));
        const transform = new Transform();
        transform.translation = vec3.create(...place.position);
        cmd.spawn(
          new Mesh2d(meshHandle),
          new colorPlugin.MeshMaterial2d(materialHandle),
          transform,
        );
      }

      // Camera2d with default ortho projection (window-sized, 1 world unit
      // per pixel). Default Transform is identity → looking at the world
      // origin along -Z. The 2D scene is composed in the XY plane with Z
      // driving the painter sort.
      cmd.spawn(...Camera2d());

      const count = all.length;
      log.info(`spawned ${count} Material2d shapes (grid + blend overlays + mask disc + parallax)`);
      // `quat` is imported for future use (e.g. rotating shapes); reference
      // it so the lint/dead-code pass doesn't strip it.
      void quat.identity;
    },
  );
};
