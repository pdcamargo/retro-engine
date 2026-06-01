import { describe, expect, it } from 'bun:test';

import { parseGltf } from './parse';
import { buildGlb, expectGltfError } from './test-support';

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe('parseGltf', () => {
  it('parses a loose .gltf JSON document', () => {
    const { document, bin } = parseGltf(json({ asset: { version: '2.0' }, meshes: [{ primitives: [] }] }));
    expect(document.asset.version).toBe('2.0');
    expect(document.meshes).toHaveLength(1);
    expect(bin).toBeUndefined();
  });

  it('parses a GLB and exposes its BIN chunk', () => {
    const result = parseGltf(buildGlb({ asset: { version: '2.0' } }, new Uint8Array([1, 2, 3, 4])));
    expect(result.document.asset.version).toBe('2.0');
    expect(result.bin?.byteLength).toBe(4);
  });

  it('ignores unknown extensions listed only in extensionsUsed', () => {
    const { document } = parseGltf(json({ asset: { version: '2.0' }, extensionsUsed: ['KHR_made_up'] }));
    expect(document.extensionsUsed).toEqual(['KHR_made_up']);
  });

  it('rejects an unsupported required extension', () => {
    expectGltfError(
      () => parseGltf(json({ asset: { version: '2.0' }, extensionsRequired: ['KHR_made_up'] })),
      'unsupported-required-extension',
    );
  });

  it('rejects malformed JSON', () => {
    expectGltfError(() => parseGltf(new TextEncoder().encode('{ not json')), 'malformed-json');
  });

  it('rejects a non-object JSON root', () => {
    expectGltfError(() => parseGltf(json(42)), 'malformed-json');
  });

  it('rejects an unsupported asset version', () => {
    expectGltfError(() => parseGltf(json({ asset: { version: '1.0' } })), 'bad-version');
  });
});
