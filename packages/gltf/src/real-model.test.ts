import { describe, expect, it } from 'bun:test';

import { decodeAccessor } from './accessor';
import { resolveBuffers } from './buffers';
import { parseGltf } from './parse';
import { loadFixture } from './test-support';

// Clover_1 is a real Blender-exported glTF (external .bin) from the sample set.
// It exercises a normalized u16 VEC4 (COLOR_0), float VEC2/VEC3 attributes, and
// u16 indices — an end-to-end check of the parser against a real exporter.
describe('real model — Clover_1.gltf', () => {
  it('parses the document and resolves its external buffer', async () => {
    const { document, bin } = parseGltf(await loadFixture('Clover_1.gltf'));
    expect(document.asset.version).toBe('2.0');
    expect(document.meshes).toHaveLength(1);
    expect(bin).toBeUndefined();

    const buffers = await resolveBuffers(document, undefined, loadFixture);
    expect(buffers).toHaveLength(1);
    expect(buffers[0]!.byteLength).toBeGreaterThanOrEqual(12956);
  });

  it('decodes POSITION (float VEC3) within its declared min/max', async () => {
    const { document } = parseGltf(await loadFixture('Clover_1.gltf'));
    const buffers = await resolveBuffers(document, undefined, loadFixture);

    const position = decodeAccessor(document, buffers, 1);
    expect(position.array).toBeInstanceOf(Float32Array);
    expect(position.componentCount).toBe(3);
    expect(position.count).toBe(267);
    expect(position.array).toHaveLength(267 * 3);

    const min = [-0.5022982358932495, -0.012792191468179226, -0.39956197142601013];
    const max = [0.2939910888671875, 1.131940245628357, 0.36432379484176636];
    const eps = 1e-4;
    for (let i = 0; i < position.count; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const v = position.array[i * 3 + c]!;
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(min[c]! - eps);
        expect(v).toBeLessThanOrEqual(max[c]! + eps);
      }
    }
  });

  it('expands the normalized u16 COLOR_0 accessor to [0, 1] floats', async () => {
    const { document } = parseGltf(await loadFixture('Clover_1.gltf'));
    const buffers = await resolveBuffers(document, undefined, loadFixture);

    const color = decodeAccessor(document, buffers, 0);
    expect(color.array).toBeInstanceOf(Float32Array);
    expect(color.normalized).toBe(true);
    expect(color.array).toHaveLength(267 * 4);
    for (const v of color.array) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('decodes the u16 index accessor', async () => {
    const { document } = parseGltf(await loadFixture('Clover_1.gltf'));
    const buffers = await resolveBuffers(document, undefined, loadFixture);

    const indices = decodeAccessor(document, buffers, 4);
    expect(indices.array).toBeInstanceOf(Uint16Array);
    expect(indices.array).toHaveLength(1137);
    for (const idx of indices.array) {
      expect(idx).toBeLessThan(267); // every index addresses a real vertex
    }
  });
});
