import type { SceneData } from '@retro-engine/engine';

/**
 * The studio's opinionated entry point for "where the scene to edit comes from".
 * It is host-agnostic: today the only implementation returns an in-memory scene,
 * so the same path runs unchanged in the browser and under Tauri. Host-backed
 * sources (a Bun dev endpoint, a Tauri file read) implement this same contract
 * later without the rest of the studio noticing.
 */
export interface SceneSource {
  /** Produce the scene to load. Async so file/endpoint-backed sources fit later. */
  load(): Promise<SceneData>;
}

/** A {@link SceneSource} that always yields the same in-memory scene. */
export const inMemorySceneSource = (data: SceneData): SceneSource => ({
  load: async (): Promise<SceneData> => data,
});
