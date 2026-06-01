import { GltfImportError } from './gltf-error';

/** Image container formats the loader recognizes. PNG and JPEG decode in v1; KTX2 is recognized but its decode is deferred. */
export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/ktx2';

/** Hints from the glTF JSON that help classify an image ahead of its bytes. */
export interface ImageMimeHint {
  /** The image's declared `mimeType`, if any. */
  mimeType?: string;
  /** The image's `uri`, used for its file extension. */
  uri?: string;
}

const SUPPORTED: ReadonlySet<string> = new Set<string>(['image/png', 'image/jpeg', 'image/ktx2']);

const fromMimeType = (mimeType: string | undefined): string | undefined => {
  if (mimeType === undefined) return undefined;
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
};

const fromUri = (uri: string | undefined): string | undefined => {
  if (uri === undefined || uri.startsWith('data:')) return undefined;
  const query = uri.indexOf('?');
  const path = (query < 0 ? uri : uri.slice(0, query)).toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.ktx2')) return 'image/ktx2';
  return undefined;
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean => {
  if (bytes.byteLength < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

const fromMagic = (bytes: Uint8Array): string | undefined => {
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png';
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(bytes, KTX2_MAGIC)) return 'image/ktx2';
  return undefined;
};

/**
 * Classify an encoded image by its declared `mimeType`, then its `uri`
 * extension, then its magic bytes. Returns the recognized {@link
 * SupportedImageMime}. Throws {@link GltfImportError} (`unsupported-image-mime`)
 * when the image is in a format the loader cannot use. This only identifies the
 * format; decoding pixels into an engine image happens in a later layer.
 */
export const detectImageMime = (bytes: Uint8Array, hint: ImageMimeHint = {}): SupportedImageMime => {
  const detected = fromMimeType(hint.mimeType) ?? fromUri(hint.uri) ?? fromMagic(bytes);
  if (detected !== undefined && SUPPORTED.has(detected)) {
    return detected as SupportedImageMime;
  }
  throw new GltfImportError(
    'unsupported-image-mime',
    `Unsupported image format${detected === undefined ? '' : ` '${detected}'`}; expected PNG, JPEG, or KTX2.`,
  );
};
