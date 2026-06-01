import type { PrimitiveTopology } from '@retro-engine/renderer-core';

import { GltfImportError } from './gltf-error';

/**
 * Maps a glTF primitive `mode` to the engine's {@link PrimitiveTopology}.
 *
 * glTF modes: `0` POINTS, `1` LINES, `2` LINE_LOOP, `3` LINE_STRIP, `4`
 * TRIANGLES (the default when `mode` is omitted), `5` TRIANGLE_STRIP, `6`
 * TRIANGLE_FAN.
 *
 * LINE_LOOP and TRIANGLE_FAN have no WebGPU topology, so they are rejected
 * rather than silently mismapped; converting their index buffers to list form
 * is deferred. This function is the single place a backend-specific topology
 * restriction would be enforced.
 *
 * @throws GltfImportError `unsupported-primitive-mode` for LINE_LOOP / TRIANGLE_FAN,
 *   `invalid-accessor` for an unknown mode value.
 */
export const mapPrimitiveMode = (mode: number = 4): PrimitiveTopology => {
  switch (mode) {
    case 0:
      return 'point-list';
    case 1:
      return 'line-list';
    case 3:
      return 'line-strip';
    case 4:
      return 'triangle-list';
    case 5:
      return 'triangle-strip';
    case 2:
      throw new GltfImportError(
        'unsupported-primitive-mode',
        'glTF primitive mode 2 (LINE_LOOP) has no engine topology; convert to LINE_STRIP first.',
      );
    case 6:
      throw new GltfImportError(
        'unsupported-primitive-mode',
        'glTF primitive mode 6 (TRIANGLE_FAN) has no engine topology; convert to TRIANGLES first.',
      );
    default:
      throw new GltfImportError(
        'invalid-accessor',
        `glTF primitive mode ${mode} is not a valid draw mode (expected 0–6).`,
      );
  }
};
