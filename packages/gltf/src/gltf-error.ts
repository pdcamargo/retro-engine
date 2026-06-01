/**
 * Discriminates the failure modes the glTF importer can raise. The code lets a
 * consumer branch on *why* an import failed without parsing the message.
 *
 * - `bad-magic` — the bytes are not a glTF/GLB file (GLB magic mismatch).
 * - `bad-version` — unsupported GLB container or `asset.version` (only glTF 2.x).
 * - `malformed-glb` — the GLB header or chunk structure is truncated or invalid.
 * - `malformed-json` — the glTF JSON could not be parsed.
 * - `unsupported-required-extension` — `extensionsRequired` lists an extension
 *   this loader does not implement; the spec forbids rendering such a file.
 * - `missing-resource` — a referenced buffer / bufferView / accessor (or the GLB
 *   BIN chunk a buffer relies on) does not exist.
 * - `out-of-bounds` — an offset, length, or sparse index reaches past its buffer.
 * - `invalid-accessor` — an accessor declares an unknown component type or type,
 *   or a sparse section is inconsistent.
 * - `unsupported-image-mime` — an image is in a format this loader cannot use.
 * - `unsupported-primitive-mode` — a primitive uses a draw mode that has no
 *   engine `PrimitiveTopology` (triangle-fan, line-loop).
 */
export type GltfErrorCode =
  | 'bad-magic'
  | 'bad-version'
  | 'malformed-glb'
  | 'malformed-json'
  | 'unsupported-required-extension'
  | 'missing-resource'
  | 'out-of-bounds'
  | 'invalid-accessor'
  | 'unsupported-image-mime'
  | 'unsupported-primitive-mode';

/**
 * Thrown when a glTF or GLB file cannot be imported. The {@link code} classifies
 * the failure; the message carries the human-readable detail. When raised from
 * inside an asset import it surfaces through the asset server's load-failure
 * channel, and no partial sub-asset graph is committed.
 */
export class GltfImportError extends Error {
  /** The category of failure. */
  readonly code: GltfErrorCode;

  constructor(code: GltfErrorCode, message: string) {
    super(message);
    this.name = 'GltfImportError';
    this.code = code;
  }
}
