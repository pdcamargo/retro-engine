import type { AssetImporter, AssetSerializer } from '@retro-engine/assets';

import { Scene } from './scene-asset';
import type { SceneData } from './scene-data';
import { SCENE_FORMAT_VERSION } from './scene-data';

/**
 * Validate a parsed JSON payload as a {@link SceneData} envelope. Guards the
 * wire-format version and the presence of the entities array so a malformed or
 * future-versioned file fails the load with a clear message rather than spawning
 * a half-decoded graph.
 */
const validateSceneData = (raw: unknown): SceneData => {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Scene: payload is not a JSON object');
  }
  const data = raw as Partial<SceneData>;
  if (data.version !== SCENE_FORMAT_VERSION) {
    throw new Error(
      `Scene: unsupported format version ${String(data.version)} (expected ${SCENE_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(data.entities)) {
    throw new Error('Scene: payload is missing an entities array');
  }
  if (data.resources !== undefined && !Array.isArray(data.resources)) {
    throw new Error('Scene: payload `resources` must be an array when present');
  }
  return data as SceneData;
};

const decodeScene = (bytes: Uint8Array): Scene =>
  new Scene(validateSceneData(JSON.parse(new TextDecoder().decode(bytes))));

/**
 * Build the {@link AssetImporter} that turns `.scene` bytes (UTF-8 JSON) into a
 * {@link Scene}. Synchronous — a scene file is self-contained JSON with no external
 * buffers to resolve through the load context; asset references inside it are
 * resolved at spawn time, not load time.
 */
export const createSceneImporter = (): AssetImporter<Scene> => (bytes) => decodeScene(bytes);

/**
 * Build the {@link AssetSerializer} that round-trips a {@link Scene} through its
 * canonical UTF-8 JSON form. The inverse of {@link createSceneImporter}; useful for
 * tooling that writes scenes back to disk.
 */
export const createSceneSerializer = (): AssetSerializer<Scene> => ({
  serialize: (scene) => new TextEncoder().encode(JSON.stringify(scene.data)),
  deserialize: (bytes) => decodeScene(bytes),
});
