// Accessor decode throughput — the per-model content-scaling hot path: walking
// buffer bytes into typed arrays. Covers an interleaved float layout (per-element
// stride arithmetic) and normalized-integer expansion (per-component dequantize).
// See docs/adr/ADR-0017.

import { bench, summary } from 'mitata';

import { decodeAccessor } from '../src/accessor';
import type { GltfDocument } from '../src/schema';

const COUNT = 50_000;

// Interleaved float VEC3, stride 32 (12 bytes of data + 20 of padding).
const STRIDE = 32;
const interleaved = new Uint8Array(STRIDE * COUNT);
{
  const dv = new DataView(interleaved.buffer);
  for (let i = 0; i < COUNT; i += 1) {
    dv.setFloat32(i * STRIDE, i, true);
    dv.setFloat32(i * STRIDE + 4, i + 1, true);
    dv.setFloat32(i * STRIDE + 8, i + 2, true);
  }
}
const interleavedDoc: GltfDocument = {
  asset: { version: '2.0' },
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: interleaved.byteLength, byteStride: STRIDE }],
  accessors: [{ bufferView: 0, componentType: 5126, count: COUNT, type: 'VEC3' }],
};

// Normalized unsigned-short VEC4 (e.g. vertex colors) → expanded to float32.
const normalized = new Uint8Array(COUNT * 4 * 2);
{
  const dv = new DataView(normalized.buffer);
  for (let i = 0; i < COUNT * 4; i += 1) dv.setUint16(i * 2, i % 65536, true);
}
const normalizedDoc: GltfDocument = {
  asset: { version: '2.0' },
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: normalized.byteLength }],
  accessors: [{ bufferView: 0, componentType: 5123, normalized: true, count: COUNT, type: 'VEC4' }],
};

summary(() => {
  bench('decode interleaved f32 VEC3 (50k)', function* () {
    yield () => decodeAccessor(interleavedDoc, [interleaved], 0);
  });
  bench('decode normalized u16 VEC4 (50k)', function* () {
    yield () => decodeAccessor(normalizedDoc, [normalized], 0);
  });
});
