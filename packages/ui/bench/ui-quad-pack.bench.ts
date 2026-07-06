// UI overlay quad packing hot path (ADR-0154, in-game UI rendering):
//
// - Each frame the UI prepare pass maps every background-filled node from
//   logical pixels to a clip-space quad and packs it into the instance buffer.
//   Cost scales with node count. This bench runs that map+pack loop over a
//   HUD-sized set of quads so a regression in the packing path shows up here.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0154 (UI overlay pass).

import { bench, summary } from 'mitata';

import { packUiColor, packUiQuad, UI_INSTANCE_FLOAT_COUNT } from '../src/render/ui-instance';
import { computeClipRect } from '../src/render/ui-prepare';

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;

interface QuadSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: number;
}

const buildQuads = (count: number): QuadSpec[] => {
  const quads: QuadSpec[] = [];
  for (let i = 0; i < count; i++) {
    quads.push({
      x: (i * 37) % VIEWPORT_W,
      y: (i * 53) % VIEWPORT_H,
      w: 40 + (i % 5) * 20,
      h: 16 + (i % 4) * 8,
      color: packUiColor((i % 7) / 7, (i % 11) / 11, (i % 13) / 13, 1),
    });
  }
  return quads;
};

const packAll = (quads: readonly QuadSpec[], f32: Float32Array, u32: Uint32Array): void => {
  let cursor = 0;
  for (const q of quads) {
    const c = computeClipRect(q.x, q.y, q.w, q.h, VIEWPORT_W, VIEWPORT_H);
    packUiQuad(c.left, c.top, c.right, c.bottom, q.color, f32, u32, cursor);
    cursor += UI_INSTANCE_FLOAT_COUNT;
  }
};

summary(() => {
  for (const count of [64, 512]) {
    const quads = buildQuads(count);
    const buffer = new ArrayBuffer(count * UI_INSTANCE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    bench(`packUiQuads ${count} nodes`, () => {
      packAll(quads, f32, u32);
    });
  }
});
