import type { AssetGuid } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import type { App, RunCondition, SceneData } from '@retro-engine/engine';
import { applyCompletedLoads, AssetServer, Scenes, serializeScene, spawnScene } from '@retro-engine/engine';

import { applyProject, buildProjectModule } from './load-project';
import type { ProjectBuilder } from './project-builder';

/** Despawn every entity the predicate does NOT mark as editor infra (the user scene). */
const despawnUserScene = (app: App, isEditorEntity: (entity: Entity) => boolean): void => {
  // Snapshot before iterating — despawn mutates the world's entity set.
  // eslint-disable-next-line unicorn/no-useless-spread
  for (const entity of [...app.world.entities()]) {
    if (!isEditorEntity(entity) && app.world.hasEntity(entity)) app.world.despawn(entity);
  }
};

/**
 * Re-read a scene from disk and respawn it into the live world — the reaction to
 * a scene file changing outside the studio. Drops the cached scene asset so the
 * server re-reads the edited file, tears down the current user scene (editor infra
 * preserved), and respawns from the fresh data; referenced assets resolve on
 * demand as before. Returns false if the scene isn't resolvable (no AssetServer,
 * or the GUID isn't loaded). Note: this replaces the in-world scene, so unsaved
 * in-studio edits to it are lost — a prompt-before-clobber is a follow-up.
 */
export const reloadProjectScene = async (deps: {
  readonly app: App;
  readonly sceneGuid: string;
  readonly isEditorEntity: (entity: Entity) => boolean;
}): Promise<boolean> => {
  const { app } = deps;
  const server = app.getResource(AssetServer);
  const scenes = app.getResource(Scenes);
  if (server === undefined || scenes === undefined) return false;

  const guid = deps.sceneGuid as AssetGuid;
  server.unloadByGuid(guid);
  server.loadByGuid(guid);
  await server.settle();
  applyCompletedLoads(server);

  const handle = scenes.handleByGuid(guid);
  const scene = handle !== undefined ? scenes.get(handle) : undefined;
  if (scene === undefined) return false;

  despawnUserScene(app, deps.isEditorEntity);
  spawnScene(app, scene.data);
  return true;
};

/** What `reloadProjectCode` needs to swap a rebuilt project into the running App. */
export interface HotReloadDeps {
  readonly app: App;
  readonly builder: ProjectBuilder;
  readonly projectDir: string;
  /** The engine + editor component/resource names captured before the project first loaded. */
  readonly baseline: { readonly components: ReadonlySet<string>; readonly resources: ReadonlySet<string> };
  /** Gate the rebuilt project's gameplay systems behind Play, exactly as the boot does. */
  readonly playGate: RunCondition;
  /** True for the editor's own infra entities (cameras / grid / gizmos), which are preserved. */
  readonly isEditorEntity: (entity: Entity) => boolean;
}

/** The outcome of a hot reload: the rebuilt plugin names, or the build error. */
export type HotReloadResult =
  | { readonly ok: true; readonly plugins: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Rebuild the project's code and swap it into the running App without a page
 * reload (ADR-0102). Builds first; only on success does it serialize the user
 * scene (editor infra excluded), tear it down, drop the old user plugins, apply
 * the rebuilt ones (play-gated, via the live `addPluginsHot` path), and respawn
 * the scene against the new registry — so component data survives even though the
 * component classes are new objects. A failed build leaves the session untouched
 * and returns the error for the caller to surface.
 */
export const reloadProjectCode = async (deps: HotReloadDeps): Promise<HotReloadResult> => {
  const { app } = deps;
  let project;
  try {
    project = await buildProjectModule(deps.builder, deps.projectDir);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Snapshot the user scene (editor infra excluded), keeping only user resources
  // so respawn doesn't re-insert engine resources. Serialize before unregistering,
  // while the current schema still describes the live components.
  const full = serializeScene(app, { filter: (e) => !deps.isEditorEntity(e) });
  const userResources = (full.resources ?? []).filter((r) => !deps.baseline.resources.has(r.type));
  const snapshot: SceneData =
    userResources.length > 0
      ? { version: full.version, entities: full.entities, resources: userResources }
      : { version: full.version, entities: full.entities };

  despawnUserScene(app, deps.isEditorEntity);

  app.removeUserPlugins(deps.baseline);
  applyProject(app, project, deps.playGate, { hot: true });
  spawnScene(app, snapshot);

  return { ok: true, plugins: project.plugins.map((p) => p.name()) };
};
