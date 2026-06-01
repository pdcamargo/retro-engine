import { describe, expect, it } from 'bun:test';

import { isGlb, readGlb } from './glb';
import { buildGlb, expectGltfError } from './test-support';

const minimalJson = { asset: { version: '2.0' } };

describe('isGlb', () => {
  it('recognizes the GLB magic', () => {
    expect(isGlb(buildGlb(minimalJson))).toBe(true);
  });

  it('rejects loose JSON bytes', () => {
    expect(isGlb(new TextEncoder().encode('{"asset":{}}'))).toBe(false);
  });

  it('rejects sub-4-byte input', () => {
    expect(isGlb(new Uint8Array([0x67, 0x6c]))).toBe(false);
  });
});

describe('readGlb', () => {
  it('walks the JSON + BIN chunks', () => {
    const bin = new Uint8Array([10, 20, 30]);
    const container = readGlb(buildGlb(minimalJson, bin));
    expect(JSON.parse(new TextDecoder().decode(container.json))).toEqual(minimalJson);
    // The BIN chunk is zero-padded to a 4-byte boundary, so 3 bytes become 4.
    expect(container.bin?.byteLength).toBe(4);
    expect(container.bin?.[0]).toBe(10);
    expect(container.bin?.[3]).toBe(0);
  });

  it('returns no bin when there is no BIN chunk', () => {
    expect(readGlb(buildGlb(minimalJson)).bin).toBeUndefined();
  });

  it('rejects a bad magic', () => {
    expectGltfError(() => readGlb(buildGlb(minimalJson, undefined, { magic: 0xdeadbeef })), 'bad-magic');
  });

  it('rejects an unsupported version', () => {
    expectGltfError(() => readGlb(buildGlb(minimalJson, undefined, { version: 1 })), 'bad-version');
  });

  it('rejects a header shorter than 12 bytes', () => {
    expectGltfError(() => readGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00])), 'malformed-glb');
  });

  it('rejects a first chunk that is not JSON', () => {
    // 0x004E4942 = BIN; a GLB whose first chunk is BIN is malformed.
    expectGltfError(() => readGlb(buildGlb(minimalJson, undefined, { firstChunkType: 0x004e4942 })), 'malformed-glb');
  });

  it('rejects a chunk that overruns the file', () => {
    const u8 = new Uint8Array(12 + 8);
    const dv = new DataView(u8.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, u8.byteLength, true);
    dv.setUint32(12, 0xffff, true); // chunkLength far beyond the buffer
    dv.setUint32(16, 0x4e4f534a, true);
    expectGltfError(() => readGlb(u8), 'malformed-glb');
  });
});
