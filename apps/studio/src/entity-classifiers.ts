import { defaultClassifiers, type EntityClassifier } from '@retro-engine/editor-sdk';
import { GltfInstanceNodes, GltfSceneRoot } from '@retro-engine/gltf';

/**
 * Hierarchy classifiers for the studio: a glTF-instance matcher (the studio
 * depends on `@retro-engine/gltf`, the engine-agnostic editor-sdk does not)
 * prepended to the editor-sdk defaults.
 */
export const studioClassifiers: readonly EntityClassifier[] = [
  (w, e) => (w.has(e, GltfSceneRoot) || w.has(e, GltfInstanceNodes) ? { icon: 'boxes', kind: 'gltf' } : undefined),
  ...defaultClassifiers,
];
