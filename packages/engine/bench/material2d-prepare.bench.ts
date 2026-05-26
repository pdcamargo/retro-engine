// Material2d prepare hot path (Phase 8.7 / ADR-0035):
//
//   `ColorMaterial2d.prepareBindGroup × 1000` — the cost of walking the schema,
//   packing the UBO bytes, and creating one bind group. The 3D version of this
//   bench (`prepare-bind-group.bench.ts`) measures a seven-binding PBR
//   material; this one measures the minimal two-field ColorMaterial2d uniform.
//
// The per-instance transform packing cost lives in `mesh-instancing.bench.ts`.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0035 (Material2d).

import { bench, summary } from 'mitata';

import { vec4 } from '@retro-engine/math';

import { Images, RenderImages } from '../src';
import { ColorMaterial2d } from '../src/material2d';
import { prepareBindGroup, schemaToBindGroupLayout } from '../src/material';

import { makeRenderingBenchRenderer } from './helpers';

const seedColorMaterial = (): {
  renderer: ReturnType<typeof makeRenderingBenchRenderer>;
  images: Images;
  renderImages: RenderImages;
  layout: ReturnType<typeof schemaToBindGroupLayout>;
} => {
  const renderer = makeRenderingBenchRenderer();
  const images = new Images();
  const renderImages = new RenderImages();
  const layout = schemaToBindGroupLayout(
    renderer,
    ColorMaterial2d.bindGroup,
    'color-material-2d-bench',
  );
  return { renderer, images, renderImages, layout };
};

summary(() => {
  bench('ColorMaterial2d.prepareBindGroup × 1000', () => {
    const { renderer, images, renderImages, layout } = seedColorMaterial();
    const scratch = new ArrayBuffer(64);
    for (let i = 0; i < 1000; i++) {
      const material = new ColorMaterial2d({
        color: vec4.create(((i * 53) % 100) / 100, ((i * 71) % 100) / 100, 0.5, 1),
      });
      prepareBindGroup(
        renderer,
        ColorMaterial2d.bindGroup,
        layout,
        material,
        undefined,
        scratch,
        images,
        renderImages,
        `color-material-2d-bench#${i}`,
      );
    }
  });
});
