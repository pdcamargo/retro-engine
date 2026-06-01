import { GltfImportError } from './gltf-error';
import type { GltfDocument } from './schema';

/**
 * The glTF extensions this loader implements. Empty for v1 (core glTF only):
 * any extension a file lists in `extensionsRequired` is therefore rejected until
 * support lands.
 */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set<string>();

/**
 * Enforce the required-extension contract: if `document.extensionsRequired`
 * names any extension absent from {@link SUPPORTED_EXTENSIONS}, throw
 * {@link GltfImportError} (`unsupported-required-extension`) — the spec forbids
 * rendering a file whose required extensions are unsupported. Extensions present
 * only in `extensionsUsed` are advisory and ignored.
 */
export const assertSupportedExtensions = (document: GltfDocument): void => {
  const required = document.extensionsRequired;
  if (required === undefined) return;
  for (const ext of required) {
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new GltfImportError(
        'unsupported-required-extension',
        `glTF requires unsupported extension '${ext}'.`,
      );
    }
  }
};
