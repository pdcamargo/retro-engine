// UI overlay image packing hot path (ADR-0154, in-game UI rendering):
//
// - Each frame the UI image prepare pass maps every UiImage node from logical
//   pixels to a clip-space quad + source-UV rect and packs it into the instance
//   buffer. Cost scales with node count. This bench runs that map+pack loop over
//   a HUD-sized set of image quads so a regression in the path shows up here.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0150 (UI architecture).

import { bench, summary } from 'mitata';

import { packUiImage, UI_IMAGE_FLOAT_COUNT } from '../src/render/ui-image-instance';
import { packUiColor } from '../src/render/ui-instance';
import { computeClipRect } from '../src/render/ui-prepare';

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;

interface ImageSpec {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tint: number;
}

const buildImages = (count: number): ImageSpec[] => {
  const images: ImageSpec[] = [];
  for (let i = 0; i < count; i++) {
    images.push({
      x: (i * 37) % VIEWPORT_W,
      y: (i * 53) % VIEWPORT_H,
      w: 32 + (i % 4) * 16,
      h: 32 + (i % 4) * 16,
      tint: packUiColor((i % 7) / 7, (i % 11) / 11, (i % 13) / 13, 1),
    });
  }
  return images;
};

const packAll = (images: readonly ImageSpec[], f32: Float32Array, u32: Uint32Array): void => {
  let cursor = 0;
  for (const img of images) {
    const c = computeClipRect(img.x, img.y, img.w, img.h, VIEWPORT_W, VIEWPORT_H);
    packUiImage(c.left, c.top, c.right, c.bottom, 0, 0, 1, 1, img.tint, f32, u32, cursor);
    cursor += UI_IMAGE_FLOAT_COUNT;
  }
};

summary(() => {
  for (const count of [64, 512]) {
    const images = buildImages(count);
    const buffer = new ArrayBuffer(count * UI_IMAGE_FLOAT_COUNT * 4);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    bench(`packUiImages ${count} nodes`, () => {
      packAll(images, f32, u32);
    });
  }
});
