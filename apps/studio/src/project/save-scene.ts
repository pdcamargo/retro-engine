import type { AssetGuid, AssetSink } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import type { App } from '@retro-engine/engine';
import { serializeScene } from '@retro-engine/engine';

import { saveProject } from './save-project';

/** What {@link saveScene} needs to write the open scene back to its source file. */
export interface SaveSceneDeps {
  readonly app: App;
  /** The project sink the scene file is written through. */
  readonly sink: AssetSink;
  /** The open scene's stable identity — reused so the file and all references stay fixed. */
  readonly guid: string;
  /** The scene file's location within the project (e.g. `'scenes/main.rescene'`). */
  readonly location: string;
  /** True for the editor's own infra entities (cameras / grid / gizmos), which are not persisted. */
  readonly isEditorEntity: (entity: Entity) => boolean;
  /**
   * Called immediately before and after the write so the caller can suppress the
   * fs watcher's self-triggered reload (writing the scene fires the watcher, which
   * would otherwise re-read and respawn the world).
   */
  readonly suppressReload?: () => void;
}

/** The outcome of a save: the number of authored entities written, or the error. */
export type SaveSceneResult =
  | { readonly ok: true; readonly entities: number }
  | { readonly ok: false; readonly error: string };

/**
 * Serialize the open scene (editor infra excluded) and write it back to its own
 * file, keeping its GUID so references stay stable. Suppresses the project
 * watcher around the write so the studio's own save does not trigger a reload of
 * the world it just serialized. Returns the entity count on success, or the error.
 */
export const saveScene = async (deps: SaveSceneDeps): Promise<SaveSceneResult> => {
  const { app } = deps;
  try {
    const data = serializeScene(app, { filter: (e) => !deps.isEditorEntity(e) });
    deps.suppressReload?.();
    await saveProject(app, deps.sink, {
      scenes: [{ location: deps.location, guid: deps.guid as AssetGuid, data }],
    });
    deps.suppressReload?.();
    return { ok: true, entities: data.entities.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
