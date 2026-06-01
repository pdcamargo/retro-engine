import { expect } from 'bun:test';

import { GltfImportError } from './gltf-error';
import type { GltfErrorCode } from './gltf-error';

/** Read a binary fixture from the package's `__fixtures__` directory. */
export const loadFixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(await Bun.file(`${import.meta.dir}/__fixtures__/${name}`).arrayBuffer());

/** Assert that `fn` throws a {@link GltfImportError} carrying the given `code`. */
export const expectGltfError = (fn: () => unknown, code: GltfErrorCode): void => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GltfImportError);
    expect((err as GltfImportError).code).toBe(code);
    return;
  }
  throw new Error(`expected GltfImportError('${code}') but nothing was thrown`);
};

/** Async variant of {@link expectGltfError} for promise-returning work. */
export const expectGltfErrorAsync = async (work: Promise<unknown>, code: GltfErrorCode): Promise<void> => {
  try {
    await work;
  } catch (err) {
    expect(err).toBeInstanceOf(GltfImportError);
    expect((err as GltfImportError).code).toBe(code);
    return;
  }
  throw new Error(`expected GltfImportError('${code}') but nothing was thrown`);
};

const encoder = new TextEncoder();

/**
 * Build a GLB container from a JSON object and optional BIN bytes, with correct
 * 4-byte chunk padding (spaces in JSON, zeros in BIN). The header fields can be
 * overridden to construct invalid containers for negative tests.
 */
export const buildGlb = (
  json: unknown,
  bin?: Uint8Array,
  overrides: { magic?: number; version?: number; firstChunkType?: number } = {},
): Uint8Array => {
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunkLen = jsonBytes.byteLength + jsonPad;
  const binPad = bin ? (4 - (bin.byteLength % 4)) % 4 : 0;
  const binChunkLen = bin ? bin.byteLength + binPad : 0;
  const total = 12 + 8 + jsonChunkLen + (bin ? 8 + binChunkLen : 0);

  const u8 = new Uint8Array(total);
  const dv = new DataView(u8.buffer);
  dv.setUint32(0, overrides.magic ?? 0x46546c67, true);
  dv.setUint32(4, overrides.version ?? 2, true);
  dv.setUint32(8, total, true);

  let o = 12;
  dv.setUint32(o, jsonChunkLen, true);
  dv.setUint32(o + 4, overrides.firstChunkType ?? 0x4e4f534a, true);
  o += 8;
  u8.set(jsonBytes, o);
  for (let i = 0; i < jsonPad; i += 1) u8[o + jsonBytes.byteLength + i] = 0x20;
  o += jsonChunkLen;

  if (bin) {
    dv.setUint32(o, binChunkLen, true);
    dv.setUint32(o + 4, 0x004e4942, true);
    o += 8;
    u8.set(bin, o);
  }
  return u8;
};
