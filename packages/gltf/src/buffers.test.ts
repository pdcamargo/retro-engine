import { describe, expect, it } from 'bun:test';

import { resolveBuffers, sliceBufferView } from './buffers';
import type { GltfDocument } from './schema';
import { expectGltfError, expectGltfErrorAsync } from './test-support';

const asset = { version: '2.0' };

describe('resolveBuffers', () => {
  it('reads an external buffer through the injected reader', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const doc: GltfDocument = { asset, buffers: [{ uri: 'mesh.bin', byteLength: 4 }] };
    const seen: string[] = [];
    const [resolved] = await resolveBuffers(doc, undefined, async (rel) => {
      seen.push(rel);
      return bytes;
    });
    expect(seen).toEqual(['mesh.bin']);
    expect(resolved).toBe(bytes);
  });

  it('forwards a data: URI to the reader unchanged', async () => {
    // resolveBuffers is agnostic: a data: URI is just another uri the reader
    // resolves. The reader here mimics the load context's inline base64 decode.
    const uri = 'data:application/octet-stream;base64,AQIDBA=='; // [1,2,3,4]
    const doc: GltfDocument = { asset, buffers: [{ uri, byteLength: 4 }] };
    const [resolved] = await resolveBuffers(doc, undefined, async (rel) => {
      const b64 = rel.slice(rel.indexOf(',') + 1);
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    });
    expect(Array.from(resolved!)).toEqual([1, 2, 3, 4]);
  });

  it('uses the GLB BIN chunk for a uri-less buffer', async () => {
    const bin = new Uint8Array([9, 8, 7, 6]);
    const doc: GltfDocument = { asset, buffers: [{ byteLength: 4 }] };
    const [resolved] = await resolveBuffers(doc, bin, async () => new Uint8Array());
    expect(resolved).toBe(bin);
  });

  it('rejects a uri-less buffer when there is no BIN chunk', async () => {
    const doc: GltfDocument = { asset, buffers: [{ byteLength: 4 }] };
    await expectGltfErrorAsync(resolveBuffers(doc, undefined, async () => new Uint8Array()), 'missing-resource');
  });

  it('rejects a buffer that resolves to fewer bytes than declared', async () => {
    const doc: GltfDocument = { asset, buffers: [{ uri: 'short.bin', byteLength: 8 }] };
    await expectGltfErrorAsync(resolveBuffers(doc, undefined, async () => new Uint8Array(4)), 'out-of-bounds');
  });
});

describe('sliceBufferView', () => {
  const buffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const doc: GltfDocument = {
    asset,
    bufferViews: [
      { buffer: 0, byteOffset: 2, byteLength: 4 },
      { buffer: 0, byteOffset: 6, byteLength: 4 }, // overruns the 8-byte buffer
      { buffer: 9, byteOffset: 0, byteLength: 1 }, // missing buffer
    ],
  };

  it('returns the byte window a bufferView spans', () => {
    expect(Array.from(sliceBufferView(doc, [buffer], 0))).toEqual([2, 3, 4, 5]);
  });

  it('rejects a missing bufferView', () => {
    expectGltfError(() => sliceBufferView(doc, [buffer], 7), 'missing-resource');
  });

  it('rejects a bufferView referencing a missing buffer', () => {
    expectGltfError(() => sliceBufferView(doc, [buffer], 2), 'missing-resource');
  });

  it('rejects a bufferView that overruns its buffer', () => {
    expectGltfError(() => sliceBufferView(doc, [buffer], 1), 'out-of-bounds');
  });
});
