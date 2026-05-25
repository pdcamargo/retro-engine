// Visual harness for Phase 8.5's `TextureSlicer` (ADR-0034).
//
// Spawns one centered `Sprite` carrying a 9-slice `imageMode` against a
// procedurally generated 32×32 rounded-rectangle "panel" texture. A `Pulse`
// system scales `customSize` sinusoidally between a small and large
// footprint each frame; the four corners stay at their 4-pixel source size
// in destination units while the edges and centre stretch, so the rounded
// corners stay visibly crisp at every footprint size.
//
// Set `?mode=slice` on the playground URL to load this showcase.

import { vec2, vec3, vec4 } from '@retro-engine/math';
import type { Plugin } from '@retro-engine/engine';
import {
  BorderRect,
  Camera2d,
  ClearColorConfig,
  Commands,
  Image,
  Images,
  Query,
  Res,
  ResMut,
  Sprite,
  SpritePlugin,
  TextureSlicer,
  Time,
  Transform,
} from '@retro-engine/engine';

const PANEL_PX = 32 as const;
const CORNER_RADIUS_PX = 6 as const;
const BORDER_THICKNESS_PX = 2 as const;
// 4-pixel border slice on every side. Combined with the panel's rounded
// corner radius this carves out the rounded edges into the four fixed-size
// corner quads — they stay visibly crisp at every destination size.
const SLICE_BORDER_PX = 4 as const;

/**
 * Build a 32×32 RGBA8 image containing a rounded rectangle: a dark fill, a
 * lighter outline, and a centre accent stripe so the 9-slice subdivision is
 * unambiguous when the sprite stretches. Drawn via the DOM `<canvas>` 2D
 * API; identical pattern to `atlas-showcase-plugin.ts`.
 */
const buildPanelTexture = (): Image => {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_PX;
  canvas.height = PANEL_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('slice-showcase: 2D canvas context unavailable');
  }
  ctx.imageSmoothingEnabled = false;

  // Transparent background — only the rounded rectangle paints pixels.
  ctx.clearRect(0, 0, PANEL_PX, PANEL_PX);

  // Outer rounded rectangle (border colour).
  ctx.fillStyle = '#f4d35e'; // amber outline
  roundedRect(ctx, 0, 0, PANEL_PX, PANEL_PX, CORNER_RADIUS_PX);
  ctx.fill();

  // Inner rounded rectangle (fill colour) — inset by the border thickness.
  ctx.fillStyle = '#2c3e50'; // navy fill
  const innerInset = BORDER_THICKNESS_PX;
  const innerRadius = Math.max(0, CORNER_RADIUS_PX - innerInset);
  roundedRect(
    ctx,
    innerInset,
    innerInset,
    PANEL_PX - innerInset * 2,
    PANEL_PX - innerInset * 2,
    innerRadius,
  );
  ctx.fill();

  // Central accent dot — gives the centre slice a visible feature so a
  // stretched panel shows the centre stretching while the corners hold.
  ctx.fillStyle = '#f4d35e';
  ctx.beginPath();
  ctx.arc(PANEL_PX / 2, PANEL_PX / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, PANEL_PX, PANEL_PX);
  const data = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  return Image.fromBytes({
    data,
    format: 'rgba8unorm',
    width: PANEL_PX,
    height: PANEL_PX,
    sampler: { magFilter: 'nearest', minFilter: 'nearest' },
    label: 'slice-showcase-panel',
  });
};

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
};

/**
 * Marker: an entity whose `Sprite.customSize` is animated by `pulseSystem`.
 * Carries the sinusoid's per-axis min/max destination size in world units.
 */
class Pulse {
  constructor(
    public readonly minW: number,
    public readonly maxW: number,
    public readonly minH: number,
    public readonly maxH: number,
    /** Phase offset so neighbour entities don't all breathe in lockstep. */
    public readonly phase: number = 0,
  ) {}
}

/**
 * Playground showcase: one centered 9-slice panel that pulses between a
 * narrow-tall and wide-short footprint, demonstrating that corner pixels
 * stay at their source size while the edges and centre stretch.
 */
export const sliceShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('slice-showcase');
  app.addPlugin(new SpritePlugin());

  app.addSystem(
    'startup',
    [Commands, ResMut(Images)],
    (cmd, images) => {
      const panel = images.add(buildPanelTexture());
      const slicer = new TextureSlicer({ border: BorderRect.all(SLICE_BORDER_PX) });

      // Wide-aspect main panel: pulses on both axes so horizontal vs vertical
      // stretching is visible side-by-side. Corners (4 source px) appear at
      // 4 destination px regardless of footprint — the visible "crisp corner"
      // proof point.
      cmd.spawn(
        new Sprite({
          image: panel,
          color: vec4.create(1, 1, 1, 1),
          customSize: vec2.create(320, 160),
          imageMode: { kind: 'sliced', slicer },
        }),
        new Transform(vec3.create(0, 0, 0)),
        new Pulse(140, 460, 80, 220, 0),
      );

      // For side-by-side comparison: same texture, same pulse, but
      // `imageMode: undefined`. Renders as a single stretched quad — corners
      // smear as the footprint changes. Placed below the main panel.
      cmd.spawn(
        new Sprite({
          image: panel,
          color: vec4.create(1, 1, 1, 1),
          customSize: vec2.create(320, 80),
        }),
        new Transform(vec3.create(0, -180, 0)),
        new Pulse(140, 460, 40, 120, Math.PI),
      );

      cmd.spawn(
        ...Camera2d({
          clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.07, b: 0.1, a: 1 }),
        }),
      );
      log.info(
        'spawned 1 sliced + 1 unsliced panel — pulse animates customSize to compare corner behaviour',
      );
    },
  );

  // Sinusoid-driven `customSize` mutator. Updates both axes per frame from
  // `Time.virtual.elapsed` so pausing virtual time freezes the pulse, and
  // calls `markChanged(Sprite)` so any downstream `Changed<Sprite>` observer
  // sees the size update. The render-prepare path reads `sprite.customSize`
  // directly and does not need the change-detection signal.
  app.addSystem('update', [Query([Sprite, Pulse]), Res(Time)], (q, time) => {
    const t = (time as Time).virtual.elapsed;
    for (const [entity, sprite, pulse] of q.entries()) {
      const factor = (Math.sin(t + pulse.phase) + 1) / 2; // 0 → 1
      const w = pulse.minW + (pulse.maxW - pulse.minW) * factor;
      const h = pulse.minH + (pulse.maxH - pulse.minH) * factor;
      sprite.customSize![0] = w;
      sprite.customSize![1] = h;
      app.world.markChanged(entity, Sprite);
    }
  });
};
