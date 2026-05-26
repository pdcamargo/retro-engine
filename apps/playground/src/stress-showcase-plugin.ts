// FPS stress harness — spawns a mix of 3D meshes, 2D meshes, static sprites,
// and atlas-animated sprites at three intensity levels, then logs measured
// FPS every ~1 second.
//
// URL params:
//   ?mode=stress             → defaults to size=small
//   ?mode=stress&size=small  → 100 of each kind (400 entities)
//   ?mode=stress&size=medium → 1 000 of each kind (4 000 entities)
//   ?mode=stress&size=large  → 25 000 of each kind (100 000 entities)
//
// Two cameras are spawned: a Camera3d at order=0 renders the 3D meshes into
// Core3d (clears the surface to a dark tint), then a Camera2d at order=1
// with `clearColor: ClearColorConfig.None` composites the 2D meshes + sprite
// + animated-sprite passes on top via `LoadOp::Load`. Confirmed by ADR-0029
// + the camera-bundles surface; same pattern the render-graph-plugin tests
// exercise.
//
// FPS is sampled by an `FpsAccumulator` resource — a per-update system
// increments the frame counter and accumulates `time.virtual.delta`; on
// crossing the 1 s threshold it logs once and resets. Per-frame logging
// would taint the measurement (V8 / browser DevTools serialization stalls
// vary by message), so the sampler aggregates instead.

import { quat, vec2, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  AtlasAnimation,
  Camera2d,
  Camera3d,
  Circle,
  ClearColorConfig,
  ColorMaterial2d,
  ColorMaterial2dPlugin,
  Commands,
  Cuboid,
  Image,
  Images,
  MaterialPlugin,
  Material2dPlugin,
  Mesh2d,
  Mesh3d,
  Meshes,
  Rectangle,
  Res,
  ResMut,
  Sphere,
  Sprite,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
  Time,
  Transform,
  UnlitMaterial,
  UnlitMaterialPlugin,
} from '@retro-engine/engine';

type SizePreset = 'small' | 'medium' | 'large';

interface Counts {
  meshes3d: number;
  meshes2d: number;
  sprites: number;
  animatedSprites: number;
}

const COUNTS: Record<SizePreset, Counts> = {
  small: { meshes3d: 100, meshes2d: 100, sprites: 100, animatedSprites: 100 },
  medium: { meshes3d: 1000, meshes2d: 1000, sprites: 1000, animatedSprites: 1000 },
  large: { meshes3d: 25_000, meshes2d: 25_000, sprites: 25_000, animatedSprites: 25_000 },
};

const parseSize = (): SizePreset => {
  const raw = new URLSearchParams(window.location.search).get('size');
  if (raw === 'medium' || raw === 'large') return raw;
  return 'small';
};

// Deterministic PRNG so successive page loads see identical scatter; lets
// the user re-run a size preset and compare FPS without scatter-noise being
// a confound. mulberry32 is overkill but matches the engine's bench style.
const mulberry32 = (seed: number): (() => number) => {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

class FpsAccumulator {
  frames = 0;
  elapsedSec = 0;
  // First sample is dropped — the very first frame's `time.virtual.delta` is
  // 0 by contract (the engine's `Time.tick` returns early on `lastMs ===
  // undefined`), and the next few frames include startup cost (asset
  // upload, pipeline compilation). Reporting them as "FPS" would lie. Once
  // we've seen the threshold cross once we drop the partial sample and
  // start fresh; subsequent windows are steady-state.
  bootstrapping = true;
}

const PALETTE_3D: ReadonlyArray<readonly [number, number, number]> = [
  [0.9, 0.4, 0.4],
  [0.4, 0.9, 0.5],
  [0.4, 0.55, 0.9],
  [0.9, 0.85, 0.4],
  [0.7, 0.45, 0.9],
  [0.4, 0.85, 0.85],
];

const PALETTE_2D: ReadonlyArray<readonly [number, number, number]> = [
  [0.95, 0.6, 0.3],
  [0.3, 0.85, 0.6],
  [0.4, 0.55, 0.95],
  [0.85, 0.4, 0.7],
];

const TILE_PX = 24 as const;
const TILE_COLS = 4 as const;
const TILE_ROWS = 4 as const;
const SHEET_PX = TILE_PX * TILE_COLS;

const ANIM_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [231, 76, 60],
  [241, 196, 15],
  [46, 204, 113],
  [52, 152, 219],
  [155, 89, 182],
  [26, 188, 156],
  [230, 126, 34],
  [231, 76, 167],
  [253, 184, 19],
  [192, 57, 43],
  [39, 174, 96],
  [41, 128, 185],
  [142, 68, 173],
  [44, 62, 80],
  [127, 140, 141],
  [236, 240, 241],
];

const buildAnimSheet = (): Image => {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_PX;
  canvas.height = SHEET_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('stress-showcase: 2D canvas context unavailable');
  }
  ctx.imageSmoothingEnabled = false;
  for (let tr = 0; tr < TILE_ROWS; tr++) {
    for (let tc = 0; tc < TILE_COLS; tc++) {
      const tileIdx = tr * TILE_COLS + tc;
      const [r, g, b] = ANIM_PALETTE[tileIdx]!;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(tc * TILE_PX, tr * TILE_PX, TILE_PX, TILE_PX);
    }
  }
  const imageData = ctx.getImageData(0, 0, SHEET_PX, SHEET_PX);
  const data = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    width: SHEET_PX,
    height: SHEET_PX,
    sampler: { magFilter: 'nearest', minFilter: 'nearest' },
    label: 'stress-anim-tilesheet',
  });
};

/**
 * Playground showcase: a controllable-load FPS harness. URL parameter
 * `?size=small|medium|large` picks the entity count; defaults to `small`.
 * Spawns roughly equal proportions of 3D meshes, 2D meshes, static
 * sprites, and atlas-animated sprites, then a per-update system logs the
 * measured frame rate every ~1 s.
 */
export const stressShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('stress');
  const size = parseSize();
  const counts = COUNTS[size];

  const unlitPlugin = new MaterialPlugin(UnlitMaterial);
  app.addPlugin(new UnlitMaterialPlugin());
  app.addPlugin(unlitPlugin);

  const colorPlugin = new Material2dPlugin(ColorMaterial2d);
  app.addPlugin(new ColorMaterial2dPlugin());
  app.addPlugin(colorPlugin);

  app.addPlugin(new SpritePlugin());

  app.insertResource(new FpsAccumulator());

  app.addSystem(
    'startup',
    [
      Commands,
      ResMut(Meshes),
      ResMut(unlitPlugin.Materials),
      ResMut(colorPlugin.Materials2d),
      ResMut(Images),
      ResMut(TextureAtlasLayouts),
    ],
    (cmd, meshes, materials3d, materials2d, images, layouts) => {
      const t0 = performance.now();
      const rng = mulberry32(0xfacefeed);

      // Shared assets — one mesh per kind, one material per palette slot,
      // one shared image + atlas layout. Keeps the per-entity cost honest:
      // the stress test measures CPU prepare/queue/render-graph dispatch,
      // not asset upload bandwidth.
      const cuboidHandle = meshes.add(new Cuboid({ halfSize: [0.4, 0.4, 0.4] }).mesh().build());
      const sphereHandle = meshes.add(new Sphere({ radius: 0.4 }).mesh().build());
      const mesh3dHandles = [cuboidHandle, sphereHandle];
      const material3dHandles = PALETTE_3D.map((rgb) =>
        materials3d.add(
          new UnlitMaterial({
            color: vec4.create(rgb[0]!, rgb[1]!, rgb[2]!, 1),
          }),
        ),
      );

      const rectHandle = meshes.add(new Rectangle({ halfSize: [10, 10] }).mesh().build());
      const circleHandle = meshes.add(new Circle({ radius: 10 }).mesh().build());
      const mesh2dHandles = [rectHandle, circleHandle];
      const material2dHandles = PALETTE_2D.map((rgb) =>
        materials2d.add(new ColorMaterial2d({ color: vec4.create(rgb[0]!, rgb[1]!, rgb[2]!, 1) })),
      );

      const spriteImageHandle = images.add(
        Image.solid(vec4.create(1, 1, 1, 1), undefined, 'stress-sprite-white'),
      );

      const animSheet = images.add(buildAnimSheet());
      const animLayout = layouts.add(
        TextureAtlasLayout.fromGrid({
          tileSize: vec2.create(TILE_PX, TILE_PX),
          columns: TILE_COLS,
          rows: TILE_ROWS,
        }),
      );
      const animTileCount = TILE_COLS * TILE_ROWS;

      // --- 3D meshes: scatter in a box around the origin ---
      // World-space coordinates because Camera3d's PerspectiveProjection
      // operates in world units (default 60° FOV, 0.1..1000 near/far).
      // Cube edge ≈ 0.8 world units, box span = ±18 world units, so the
      // scene is broadly visible from the camera at (0, 12, 22).
      for (let i = 0; i < counts.meshes3d; i++) {
        const x = (rng() - 0.5) * 36;
        const y = (rng() - 0.5) * 24;
        const z = (rng() - 0.5) * 36;
        const meshHandle = mesh3dHandles[i % mesh3dHandles.length]!;
        const materialHandle = material3dHandles[i % material3dHandles.length]!;
        const transform = new Transform(vec3.create(x, y, z));
        cmd.spawn(
          new Mesh3d(meshHandle),
          new unlitPlugin.MeshMaterial3d(materialHandle),
          transform,
        );
      }

      // --- 2D meshes: scatter in the screen-space plane ---
      // Camera2d uses orthographic 1-pixel-per-world-unit by default; the
      // viewport at 1280×720 spans roughly ±640 × ±360. Spread covers a
      // comfortable band that doesn't all collapse into one over-draw pile.
      for (let i = 0; i < counts.meshes2d; i++) {
        const x = (rng() - 0.5) * 1200;
        const y = (rng() - 0.5) * 680;
        const meshHandle = mesh2dHandles[i % mesh2dHandles.length]!;
        const materialHandle = material2dHandles[i % material2dHandles.length]!;
        const transform = new Transform(vec3.create(x, y, (rng() - 0.5) * 0.1));
        cmd.spawn(
          new Mesh2d(meshHandle),
          new colorPlugin.MeshMaterial2d(materialHandle),
          transform,
        );
      }

      // --- Static sprites: tint-only quads, all sharing one 8×8 image ---
      for (let i = 0; i < counts.sprites; i++) {
        const x = (rng() - 0.5) * 1200;
        const y = (rng() - 0.5) * 680;
        const tint = PALETTE_2D[i % PALETTE_2D.length]!;
        cmd.spawn(
          new Sprite({
            image: spriteImageHandle,
            color: vec4.create(tint[0]!, tint[1]!, tint[2]!, 1),
            customSize: vec2.create(14, 14),
          }),
          new Transform(vec3.create(x, y, (rng() - 0.5) * 0.1)),
        );
      }

      // --- Atlas-animated sprites: all share one 96×96 atlas + layout ---
      // Each entity carries an AtlasAnimation that ticks `TextureAtlas.index`
      // at ~6 fps (matches atlas-showcase). The atlas-sync system writes
      // `sprite.rect` from the layout + index in `postUpdate` before the
      // sprite prepare batcher runs, so all 1k / 25k animated entities
      // share one (image, alphaBucket) batch — the Phase 8.8 sort-then-walk
      // path collapses them with within-batch Z order honoured.
      for (let i = 0; i < counts.animatedSprites; i++) {
        const x = (rng() - 0.5) * 1200;
        const y = (rng() - 0.5) * 680;
        const startIdx = i % animTileCount;
        cmd.spawn(
          new Sprite({
            image: animSheet,
            color: vec4.create(1, 1, 1, 1),
            customSize: vec2.create(16, 16),
            flipY: true,
          }),
          new TextureAtlas(animLayout, startIdx),
          new Transform(vec3.create(x, y, (rng() - 0.5) * 0.1)),
          new AtlasAnimation({
            firstIndex: 0,
            lastIndex: animTileCount - 1,
            fps: 6,
            mode: 'loop',
          }),
        );
      }

      // Camera3d at (0, 12, 22), tilted ~25° downward. Renders first into
      // Core3d (default clear to App's clearColor → dark navy).
      const camTransform = new Transform();
      camTransform.translation = vec3.create(0, 12, 22);
      quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 7, camTransform.rotation);
      cmd.spawn(...Camera3d({ order: 0, transform: camTransform }));

      // Camera2d at order=1 with clearColor: None → LoadOp::Load. Composites
      // the Core2d phases on top of the prior Camera3d output.
      cmd.spawn(...Camera2d({ order: 1, clearColor: ClearColorConfig.None }));

      const ms = (performance.now() - t0).toFixed(1);
      const total =
        counts.meshes3d + counts.meshes2d + counts.sprites + counts.animatedSprites;
      log.info(
        `size=${size} → spawned ${total} entities (${counts.meshes3d} mesh3d / ${counts.meshes2d} mesh2d / ${counts.sprites} sprites / ${counts.animatedSprites} animated) in ${ms} ms`,
      );
      log.info('FPS sampler logging every ~1 s (drops the bootstrap window)');
    },
  );

  app.addSystem('update', [ResMut(FpsAccumulator), Res(Time)], (acc, time) => {
    const dt = (time as Time).virtual.delta;
    // First frame ships dt=0 by contract — skip it so the average isn't
    // biased by the engine's startup tick. Subsequent zeros (paused
    // virtual time) are unlikely here but cheap to filter.
    if (dt <= 0) return;
    acc.frames += 1;
    acc.elapsedSec += dt;
    if (acc.elapsedSec < 1) return;
    const fps = acc.frames / acc.elapsedSec;
    if (acc.bootstrapping) {
      acc.bootstrapping = false;
      log.info(`(bootstrap) ${acc.frames} frames in ${acc.elapsedSec.toFixed(2)}s — discarded`);
    } else {
      const frameMs = (1000 * acc.elapsedSec) / acc.frames;
      log.info(`fps=${fps.toFixed(1)} (${acc.frames} frames / ${acc.elapsedSec.toFixed(2)}s, ${frameMs.toFixed(2)} ms/frame)`);
    }
    acc.frames = 0;
    acc.elapsedSec = 0;
  });
};
