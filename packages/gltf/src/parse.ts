import { assertSupportedExtensions } from './extensions';
import { isGlb, readGlb } from './glb';
import { GltfImportError } from './gltf-error';
import type { GltfDocument } from './schema';

/**
 * A parsed glTF document plus the GLB binary chunk it was packaged with, if any.
 * `bin` is the byte source for buffers that omit a `uri` (the GLB BIN-chunk
 * buffer).
 */
export interface ParsedGltf {
  readonly document: GltfDocument;
  readonly bin?: Uint8Array;
}

const decoder = /* @__PURE__ */ new TextDecoder('utf-8');

const parseJson = (json: Uint8Array): GltfDocument => {
  let text: string;
  try {
    text = decoder.decode(json);
  } catch {
    throw new GltfImportError('malformed-json', 'glTF JSON is not valid UTF-8.');
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    throw new GltfImportError('malformed-json', `glTF JSON could not be parsed: ${String(cause)}`);
  }
  if (typeof document !== 'object' || document === null) {
    throw new GltfImportError('malformed-json', 'glTF JSON root is not an object.');
  }
  return document as GltfDocument;
};

const validate = (document: GltfDocument): void => {
  const version = document.asset?.version;
  if (typeof version !== 'string' || !version.startsWith('2.')) {
    throw new GltfImportError('bad-version', `Unsupported glTF asset version '${String(version)}'; only 2.x is supported.`);
  }
  assertSupportedExtensions(document);
};

/**
 * Parse raw bytes into a glTF document, transparently handling both packagings:
 * a `.glb` binary container (header + JSON chunk + optional BIN chunk) and a
 * loose `.gltf` JSON file. Validates the asset version and the required-extension
 * contract. Throws {@link GltfImportError} on a malformed container, malformed
 * JSON, an unsupported version, or an unsupported required extension.
 */
export const parseGltf = (bytes: Uint8Array): ParsedGltf => {
  if (isGlb(bytes)) {
    const container = readGlb(bytes);
    const document = parseJson(container.json);
    validate(document);
    return container.bin === undefined ? { document } : { document, bin: container.bin };
  }
  const document = parseJson(bytes);
  validate(document);
  return { document };
};
