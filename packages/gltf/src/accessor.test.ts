import { describe, expect, it } from 'bun:test';

import { decodeAccessor } from './accessor';
import type { GltfAccessor, GltfBufferView, GltfComponentType, GltfDocument } from './schema';
import { expectGltfError } from './test-support';

const doc = (bufferViews: GltfBufferView[], accessors: GltfAccessor[]): GltfDocument => ({
  asset: { version: '2.0' },
  bufferViews,
  accessors,
});

const rawBytes = (ta: ArrayBufferView): Uint8Array =>
  new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);

describe('decodeAccessor — component types', () => {
  it('decodes a float VEC3', () => {
    const data = new Float32Array([1, 2, 3, 4, 5, 6]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array).toBeInstanceOf(Float32Array);
    expect(Array.from(out.array)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.componentCount).toBe(3);
    expect(out.count).toBe(2);
    expect(out.normalized).toBe(false);
  });

  it('keeps unsigned-short indices as a Uint16Array', () => {
    const data = new Uint16Array([0, 1, 2, 2, 1, 3]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5123, count: 6, type: 'SCALAR' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array).toBeInstanceOf(Uint16Array);
    expect(Array.from(out.array)).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it('keeps unsigned-int indices as a Uint32Array', () => {
    const data = new Uint32Array([100000, 200000]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5125, count: 2, type: 'SCALAR' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array).toBeInstanceOf(Uint32Array);
    expect(Array.from(out.array)).toEqual([100000, 200000]);
  });

  it('keeps signed bytes as an Int8Array', () => {
    const data = new Int8Array([-5, 5, 127, -128]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5120, count: 4, type: 'SCALAR' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array).toBeInstanceOf(Int8Array);
    expect(Array.from(out.array)).toEqual([-5, 5, 127, -128]);
  });
});

describe('decodeAccessor — normalized integers', () => {
  it('expands normalized unsigned bytes to [0, 1] floats', () => {
    const data = new Uint8Array([0, 128, 255, 64]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5121, normalized: true, count: 1, type: 'VEC4' }]),
      [data],
      0,
    );
    expect(out.array).toBeInstanceOf(Float32Array);
    expect(out.normalized).toBe(true);
    expect(out.array[0]).toBeCloseTo(0);
    expect(out.array[1]).toBeCloseTo(128 / 255);
    expect(out.array[2]).toBeCloseTo(1);
    expect(out.array[3]).toBeCloseTo(64 / 255);
  });

  it('expands normalized unsigned shorts to [0, 1] floats', () => {
    const data = new Uint16Array([0, 65535]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5123, normalized: true, count: 2, type: 'SCALAR' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array[0]).toBeCloseTo(0);
    expect(out.array[1]).toBeCloseTo(1);
  });

  it('expands normalized signed shorts, clamping the min to -1', () => {
    const data = new Int16Array([32767, -32768, 0]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5122, normalized: true, count: 3, type: 'SCALAR' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array[0]).toBeCloseTo(1);
    expect(out.array[1]).toBe(-1); // -32768/32767 < -1, clamped
    expect(out.array[2]).toBeCloseTo(0);
  });

  it('expands normalized signed bytes', () => {
    const data = new Int8Array([127, -128, -64]);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }], [{ bufferView: 0, componentType: 5120, normalized: true, count: 3, type: 'SCALAR' }]),
      [rawBytes(data)],
      0,
    );
    expect(out.array[0]).toBeCloseTo(1);
    expect(out.array[1]).toBe(-1);
    expect(out.array[2]).toBeCloseTo(Math.max(-64 / 127, -1));
  });
});

describe('decodeAccessor — layout', () => {
  it('honors an interleaved byteStride', () => {
    const ab = new ArrayBuffer(32);
    const dv = new DataView(ab);
    dv.setFloat32(0, 1, true);
    dv.setFloat32(4, 2, true);
    dv.setFloat32(8, 3, true);
    dv.setFloat32(16, 4, true);
    dv.setFloat32(20, 5, true);
    dv.setFloat32(24, 6, true);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: 32, byteStride: 16 }], [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }]),
      [new Uint8Array(ab)],
      0,
    );
    expect(Array.from(out.array)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('adds accessor.byteOffset onto the bufferView offset', () => {
    const ab = new ArrayBuffer(16);
    const dv = new DataView(ab);
    dv.setFloat32(8, 7, true);
    dv.setFloat32(12, 8, true);
    const out = decodeAccessor(
      doc([{ buffer: 0, byteOffset: 0, byteLength: 16 }], [{ bufferView: 0, byteOffset: 8, componentType: 5126, count: 1, type: 'VEC2' }]),
      [new Uint8Array(ab)],
      0,
    );
    expect(Array.from(out.array)).toEqual([7, 8]);
  });
});

describe('decodeAccessor — sparse', () => {
  it('overlays sparse values onto base data', () => {
    const base = new Float32Array([10, 10, 10, 10]);
    const indices = new Uint16Array([1, 3]);
    const values = new Float32Array([99, 88]);
    const out = decodeAccessor(
      doc(
        [
          { buffer: 0, byteOffset: 0, byteLength: base.byteLength },
          { buffer: 1, byteOffset: 0, byteLength: indices.byteLength },
          { buffer: 2, byteOffset: 0, byteLength: values.byteLength },
        ],
        [{ bufferView: 0, componentType: 5126, count: 4, type: 'SCALAR', sparse: { count: 2, indices: { bufferView: 1, componentType: 5123 }, values: { bufferView: 2 } } }],
      ),
      [rawBytes(base), rawBytes(indices), rawBytes(values)],
      0,
    );
    expect(Array.from(out.array)).toEqual([10, 99, 10, 88]);
  });

  it('reconstructs a sparse accessor with no base bufferView (zero-filled)', () => {
    const indices = new Uint16Array([0, 2]);
    const values = new Float32Array([5, 7]);
    const out = decodeAccessor(
      doc(
        [
          { buffer: 0, byteOffset: 0, byteLength: indices.byteLength },
          { buffer: 1, byteOffset: 0, byteLength: values.byteLength },
        ],
        [{ componentType: 5126, count: 4, type: 'SCALAR', sparse: { count: 2, indices: { bufferView: 0, componentType: 5123 }, values: { bufferView: 1 } } }],
      ),
      [rawBytes(indices), rawBytes(values)],
      0,
    );
    expect(Array.from(out.array)).toEqual([5, 0, 7, 0]);
  });

  it('rejects a sparse index outside the accessor element range', () => {
    const indices = new Uint16Array([9]);
    const values = new Float32Array([1]);
    expectGltfError(
      () =>
        decodeAccessor(
          doc(
            [
              { buffer: 0, byteOffset: 0, byteLength: indices.byteLength },
              { buffer: 1, byteOffset: 0, byteLength: values.byteLength },
            ],
            [{ componentType: 5126, count: 2, type: 'SCALAR', sparse: { count: 1, indices: { bufferView: 0, componentType: 5123 }, values: { bufferView: 1 } } }],
          ),
          [rawBytes(indices), rawBytes(values)],
          0,
        ),
      'out-of-bounds',
    );
  });
});

describe('decodeAccessor — validation', () => {
  it('rejects an accessor that reads past its buffer', () => {
    expectGltfError(
      () =>
        decodeAccessor(
          doc([{ buffer: 0, byteOffset: 0, byteLength: 12 }], [{ bufferView: 0, componentType: 5126, count: 10, type: 'VEC3' }]),
          [new Uint8Array(12)],
          0,
        ),
      'out-of-bounds',
    );
  });

  it('rejects an unknown component type', () => {
    expectGltfError(
      () =>
        decodeAccessor(
          doc([{ buffer: 0, byteOffset: 0, byteLength: 4 }], [{ bufferView: 0, componentType: 9999 as unknown as GltfComponentType, count: 1, type: 'SCALAR' }]),
          [new Uint8Array(4)],
          0,
        ),
      'invalid-accessor',
    );
  });

  it('rejects an unknown accessor type', () => {
    expectGltfError(
      () =>
        decodeAccessor(
          doc([{ buffer: 0, byteOffset: 0, byteLength: 4 }], [{ bufferView: 0, componentType: 5126, count: 1, type: 'WAT' as unknown as 'SCALAR' }]),
          [new Uint8Array(4)],
          0,
        ),
      'invalid-accessor',
    );
  });

  it('rejects a missing accessor index', () => {
    expectGltfError(() => decodeAccessor(doc([], []), [], 3), 'missing-resource');
  });
});
