import type { Assets, Handle, LoadContext } from '@retro-engine/engine';

import type { ImageDecoder } from './image-decoder';

/** Raw byte view over a typed array, for handing geometry to `decodeAccessor`. */
export const rawBytes = (ta: ArrayBufferView): Uint8Array =>
  new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);

/**
 * Stub {@link ImageDecoder} for unit tests: returns a 1×1 white RGBA8 pixel
 * without parsing the input bytes, so tests can exercise the mapping/dedup logic
 * without real image data or a DOM image API.
 */
export const stubDecoder: ImageDecoder = async () => ({
  data: new Uint8Array([255, 255, 255, 255]),
  width: 1,
  height: 1,
  format: 'rgba8unorm',
});

/**
 * Minimal {@link LoadContext} for mapping tests. `addLabeledAsset` inserts into
 * the store immediately (via `add`) and records the label; `read` serves bytes
 * from the provided file map.
 */
export const fakeLoadContext = (
  files: Readonly<Record<string, Uint8Array>> = {},
  path = 'test.gltf',
): { ctx: LoadContext; labels: string[] } => {
  const labels: string[] = [];
  const ctx: LoadContext = {
    path,
    read: async (relativePath: string): Promise<Uint8Array> => {
      const bytes = files[relativePath];
      if (bytes === undefined) throw new Error(`fakeLoadContext: no file '${relativePath}'`);
      return bytes;
    },
    addLabeledAsset: <U>(label: string, value: U, store: Assets<U>): Handle<U> => {
      labels.push(label);
      return store.add(value);
    },
  };
  return { ctx, labels };
};
