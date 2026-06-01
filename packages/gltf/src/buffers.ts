import { GltfImportError } from './gltf-error';
import type { GltfDocument } from './schema';

/**
 * Reads a resource referenced relative to the glTF file and returns its bytes.
 * Structurally matches the asset load context's `read`: an external sibling is
 * fetched through the asset source, while a `data:` URI is decoded inline. The
 * loader awaits these so a model is not considered loaded until its buffers are.
 */
export type SiblingReader = (relativePath: string) => Promise<Uint8Array>;

/**
 * Resolve every entry in `document.buffers` to its bytes. A buffer with a `uri`
 * (external file or embedded `data:` URI) is fetched via `read`; a buffer with
 * no `uri` is the GLB BIN chunk and uses `bin`. Throws {@link GltfImportError}
 * if a `uri`-less buffer has no BIN chunk to back it, or if the resolved bytes
 * are shorter than the buffer's declared `byteLength`.
 */
export const resolveBuffers = (
  document: GltfDocument,
  bin: Uint8Array | undefined,
  read: SiblingReader,
): Promise<Uint8Array[]> => {
  const buffers = document.buffers ?? [];
  return Promise.all(
    buffers.map(async (buffer, index): Promise<Uint8Array> => {
      if (buffer.uri === undefined) {
        if (bin === undefined) {
          throw new GltfImportError('missing-resource', `Buffer ${index} has no uri and the file has no GLB BIN chunk.`);
        }
        if (bin.byteLength < buffer.byteLength) {
          throw new GltfImportError('out-of-bounds', `GLB BIN chunk (${bin.byteLength} bytes) is smaller than buffer ${index} (${buffer.byteLength} bytes).`);
        }
        return bin;
      }
      const bytes = await read(buffer.uri);
      if (bytes.byteLength < buffer.byteLength) {
        throw new GltfImportError('out-of-bounds', `Buffer ${index} resolved to ${bytes.byteLength} bytes but declares ${buffer.byteLength}.`);
      }
      return bytes;
    }),
  );
};

/**
 * Return the byte window a bufferView spans, validated against its buffer's
 * bounds. Throws {@link GltfImportError} if the bufferView or its buffer is
 * missing, or if the window reaches past the buffer.
 */
export const sliceBufferView = (
  document: GltfDocument,
  buffers: readonly Uint8Array[],
  bufferViewIndex: number,
): Uint8Array => {
  const view = document.bufferViews?.[bufferViewIndex];
  if (view === undefined) {
    throw new GltfImportError('missing-resource', `bufferView ${bufferViewIndex} does not exist.`);
  }
  const buffer = buffers[view.buffer];
  if (buffer === undefined) {
    throw new GltfImportError('missing-resource', `bufferView ${bufferViewIndex} references missing buffer ${view.buffer}.`);
  }
  const offset = view.byteOffset ?? 0;
  const sliceEnd = offset + view.byteLength;
  if (sliceEnd > buffer.byteLength) {
    throw new GltfImportError('out-of-bounds', `bufferView ${bufferViewIndex} (offset ${offset}, length ${view.byteLength}) overruns buffer ${view.buffer}.`);
  }
  return buffer.subarray(offset, sliceEnd);
};
