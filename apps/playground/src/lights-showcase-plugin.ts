// Visual harness for the 2D lighting pipeline (ADR-0037, 0041, 0042, 0043).
//
// Twelve checker sprites arranged in a 4×3 grid form a static scene. Three
// `PointLight2d` entities sit at distinct grid positions with distinct
// colours: warm white at top-left, cool blue at the centre, magenta at
// bottom-right. A fourth, smaller orbit-light circles a fixed anchor each
// frame via a `Spin`-style marker so the lighting is obviously dynamic. A
// `SpotLight2d` casts a downward cone over the top row, an `AmbientLight2d`
// zone warms the bottom-left corner above the global floor, and two
// `LightOccluder2d` boxes cast moving shadows from the orbiting light. A
// bump-mapped sprite sits at centre-bottom; `?normals=1` turns on per-pixel
// N·L shading (ADR-0043) so its dome catches the moving light.
//
// `Light2dSettings.ambient` is set to a dim grey so unlit zones read as
// "in shadow" rather than "broken" — without ambient the multiply
// composite would clamp those regions to black.

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AmbientLight2d,
  Camera2d,
  ClearColorConfig,
  Commands,
  Image,
  Images,
  Light2dPlugin,
  Light2dSettings,
  LightOccluder2d,
  PointLight2d,
  Query,
  ResMut,
  Sprite,
  SpotLight2d,
  SpritePlugin,
  Time,
  Transform,
} from '@retro-engine/engine';

/**
 * Generate a `size × size` RGBA normal map of a single spherical bump centred
 * in the tile — normals point outward over the dome, flat `(0,0,1)` outside it.
 * Encoded `n * 0.5 + 0.5` for the rgba8 normal buffer.
 */
const bumpNormalMap = (size: number): Image => {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = 1 - ((y + 0.5) / size) * 2; // Y up
      const r2 = nx * nx + ny * ny;
      let vx = 0;
      let vy = 0;
      let vz = 1;
      if (r2 < 1) {
        vx = nx;
        vy = ny;
        vz = Math.sqrt(1 - r2);
      }
      const i = (y * size + x) * 4;
      data[i] = Math.round((vx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((vy * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((vz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    width: size,
    height: size,
    label: 'lights-showcase-bump-normal',
  });
};

/** Marker component: light entities that orbit a fixed anchor point. */
class Orbit {
  constructor(
    public readonly anchorX: number,
    public readonly anchorY: number,
    public readonly radius: number,
    public readonly speed: number = 1.0,
    public phase: number = 0,
  ) {}
}

const placements = (): { position: readonly [number, number]; tint: readonly [number, number, number, number] }[] => {
  // 4 columns × 3 rows.
  const cell = (col: number, row: number): [number, number] => [
    (col - 1.5) * 110,
    (row - 1) * 110,
  ];
  return [
    { position: cell(0, 0), tint: [1, 1, 1, 1] },
    { position: cell(1, 0), tint: [1, 1, 1, 1] },
    { position: cell(2, 0), tint: [1, 1, 1, 1] },
    { position: cell(3, 0), tint: [1, 1, 1, 1] },
    { position: cell(0, 1), tint: [1, 1, 1, 1] },
    { position: cell(1, 1), tint: [1, 1, 1, 1] },
    { position: cell(2, 1), tint: [1, 1, 1, 1] },
    { position: cell(3, 1), tint: [1, 1, 1, 1] },
    { position: cell(0, 2), tint: [1, 1, 1, 1] },
    { position: cell(1, 2), tint: [1, 1, 1, 1] },
    { position: cell(2, 2), tint: [1, 1, 1, 1] },
    { position: cell(3, 2), tint: [1, 1, 1, 1] },
  ];
};

/**
 * Playground showcase: spawn 12 checker-tinted sprites in a 4×3 grid plus
 * four `PointLight2d` entities — three static (warm white, cool blue,
 * magenta), one orbiting a fixed anchor to demonstrate dynamic lighting.
 * `Light2dSettings.ambient` is a low grey so unlit regions are dim rather
 * than black.
 */
export const lightsShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('lights-showcase');
  app.addPlugin(new SpritePlugin());
  app.addPlugin(new Light2dPlugin());

  app.addSystem(
    'startup',
    [Commands, ResMut(Images), ResMut(Light2dSettings)],
    (cmd, images, settings) => {
      // Dim grey ambient so the unlit cells read as "in shadow."
      settings.ambient = vec4.create(0.15, 0.15, 0.15, 1);

      // Normal mapping is opt-in via `?normals=1` so the default scene keeps
      // its flat-lit look; when on, every sprite shades by N·L and the
      // bump-mapped sprite below shows per-pixel surface detail.
      const normalsOn = new URLSearchParams(globalThis.location?.search ?? '').get('normals') === '1';
      settings.normalMapping = normalsOn;

      const checker = images.add(
        Image.checker(16, vec4.create(0.95, 0.95, 0.95, 1), vec4.create(0.35, 0.35, 0.4, 1), {
          label: 'lights-showcase-checker',
        }),
      );

      for (const place of placements()) {
        cmd.spawn(
          new Sprite({
            image: checker,
            color: vec4.create(...place.tint),
            customSize: vec2.create(96, 96),
          }),
          new Transform(vec3.create(place.position[0], place.position[1], 0)),
        );
      }

      // Three static lights at distinct corners with distinct colours.
      cmd.spawn(
        new PointLight2d({
          color: vec3.create(1, 0.85, 0.55),
          intensity: 2.2,
          range: 240,
          radius: 16,
        }),
        new Transform(vec3.create(-180, 110, 0)),
      );
      cmd.spawn(
        new PointLight2d({
          color: vec3.create(0.45, 0.7, 1),
          intensity: 1.8,
          range: 260,
          radius: 12,
        }),
        new Transform(vec3.create(0, 0, 0)),
      );
      cmd.spawn(
        new PointLight2d({
          color: vec3.create(1, 0.45, 0.85),
          intensity: 1.9,
          range: 220,
          radius: 14,
        }),
        new Transform(vec3.create(180, -110, 0)),
      );

      // Orbiting accent light — sweeps across the full grid each frame so
      // the dynamic-lighting path is obvious. Anchored at the grid centre
      // with a 220-unit radius and ~2.4 rad/s angular speed, so it traces
      // a circle that touches every quadrant in roughly 2.5 seconds.
      cmd.spawn(
        new PointLight2d({
          color: vec3.create(0.95, 1, 0.5),
          intensity: 2.4,
          range: 240,
          radius: 8,
        }),
        new Transform(vec3.create(220, 0, 0)),
        new Orbit(0, 0, 220, 2.4),
      );

      // A downward spot light casting a cone over the top row.
      cmd.spawn(
        new SpotLight2d({
          color: vec3.create(0.7, 1, 0.85),
          intensity: 2.6,
          range: 320,
          radius: 8,
          direction: vec2.create(0, -1),
          innerAngle: Math.PI / 10,
          outerAngle: Math.PI / 5,
        }),
        new Transform(vec3.create(0, 240, 0)),
      );

      // A warm regional ambient pool in the bottom-left so that area reads
      // brighter than the global grey floor even where no light reaches.
      cmd.spawn(
        new AmbientLight2d({
          color: vec3.create(1, 0.6, 0.35),
          intensity: 0.4,
          halfExtents: vec2.create(180, 140),
        }),
        new Transform(vec3.create(-260, -150, 0)),
      );

      // Two box occluders so the orbiting light visibly casts moving shadows
      // across the grid.
      cmd.spawn(
        LightOccluder2d.rect(18, 60),
        new Transform(vec3.create(-90, -40, 0)),
      );
      cmd.spawn(
        LightOccluder2d.rect(60, 18),
        new Transform(vec3.create(120, 60, 0)),
      );

      // A large bump-mapped sprite at the centre. With `?normals=1` its dome
      // catches light per-pixel as the orbit light sweeps; otherwise it renders
      // as a plain white quad.
      const bump = images.add(bumpNormalMap(64));
      cmd.spawn(
        new Sprite({
          color: vec4.create(0.8, 0.8, 0.85, 1),
          customSize: vec2.create(120, 120),
          normalMap: bump,
        }),
        new Transform(vec3.create(0, -150, 0)),
      );

      cmd.spawn(
        ...Camera2d({
          clearColor: ClearColorConfig.custom({ r: 0, g: 0, b: 0, a: 1 }),
        }),
      );
      log.info(
        `spawned 12 sprites + 4 PointLight2d (3 static, 1 orbiting) + 1 SpotLight2d + 1 AmbientLight2d zone + 2 occluders + 1 bump sprite (normals ${normalsOn ? 'on' : 'off'})`,
      );
    },
  );

  // In-place writes to `transform.translation` need an explicit
  // markChanged so the `postUpdate` Transform → GlobalTransform
  // propagation system picks the orbit up; the lighting queue reads
  // `gt.matrix[12/13]`, so without this mark the world position never
  // refreshes and the orbit is invisible.
  app.addSystem('update', [Query([Transform, Orbit]), ResMut(Time)], (orbiters, time) => {
    const dt = time.virtual.delta;
    for (const [entity, transform, orbit] of orbiters.entries()) {
      orbit.phase += orbit.speed * dt;
      transform.translation[0] = orbit.anchorX + Math.cos(orbit.phase) * orbit.radius;
      transform.translation[1] = orbit.anchorY + Math.sin(orbit.phase) * orbit.radius;
      app.world.markChanged(entity, Transform);
    }
  });
};
