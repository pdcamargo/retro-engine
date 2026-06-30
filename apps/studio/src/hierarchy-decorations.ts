import type { Entity } from '@retro-engine/ecs';
import type { IconName, RetroPalette, Srgb8 } from '@retro-engine/editor-sdk';
import {
  type App,
  AssetServer,
  hasCompositionOverrides,
  SceneInstance,
  SceneRoot,
} from '@retro-engine/engine';
import { GltfInstanceNodes, GltfSceneRoot } from '@retro-engine/gltf';

/** Per-row hierarchy styling for an instance/model root. */
export interface RowDecoration {
  /** Name + icon accent (prefab / scene / model tone). */
  readonly accent: Srgb8;
  /** Icon overriding the entity's default classification. */
  readonly icon: IconName;
  /** Source file basename shown faint after the name (e.g. `coin.prefab`). */
  readonly suffix: string | undefined;
  /** The instance was edited away from its source. */
  readonly overridden: boolean;
}

/** Hierarchy decorations for one frame: instance/model roots and their inherited subtrees. */
export interface HierarchyDecorations {
  /** Styling for each prefab/scene/model root entity. */
  readonly roots: ReadonlyMap<Entity, RowDecoration>;
  /** Entities instantiated from a source (rendered recessed). */
  readonly inherited: ReadonlySet<Entity>;
}

const basename = (location: string): string => location.slice(location.lastIndexOf('/') + 1);

/**
 * Classify the hierarchy's instance rows for this frame: prefab instances
 * (`SceneRoot` → a `.prefab` asset), nested scene instances (`SceneRoot` → a
 * scene asset), and model roots (`GltfSceneRoot`). Each gets a kind tone, icon,
 * source filename, and an override flag; their reactor-spawned subtrees are
 * collected as `inherited` so the panel can recess them. The Prefab-vs-Scene
 * split is read from the source file's extension (no manifest-kind lookup needed).
 */
export const computeHierarchyDecorations = (app: App, palette: RetroPalette): HierarchyDecorations => {
  const world = app.world;
  const server = app.getResource(AssetServer);
  const roots = new Map<Entity, RowDecoration>();
  const inherited = new Set<Entity>();

  for (const entity of world.entities()) {
    const sceneInstance = world.getComponent(entity, SceneInstance);
    if (sceneInstance !== undefined) for (const child of sceneInstance.entities) inherited.add(child);
    const gltfInstance = world.getComponent(entity, GltfInstanceNodes);
    if (gltfInstance !== undefined) for (const child of gltfInstance.derivedEntities) inherited.add(child);
  }

  const locationOf = (guid: string | undefined): string | undefined =>
    guid !== undefined ? server?.locationForGuid(guid as never) : undefined;

  for (const entity of world.entities()) {
    const sceneRoot = world.getComponent(entity, SceneRoot);
    if (sceneRoot !== undefined) {
      const location = locationOf(sceneRoot.handle.guid);
      const isPrefab = location?.endsWith('.prefab') === true;
      roots.set(entity, {
        accent: isPrefab ? palette.prefab : palette.scene,
        icon: isPrefab ? 'box' : 'clapperboard',
        suffix: location !== undefined ? basename(location) : undefined,
        overridden: hasCompositionOverrides(app, entity),
      });
      continue;
    }
    const gltfRoot = world.getComponent(entity, GltfSceneRoot);
    if (gltfRoot !== undefined) {
      const location = locationOf(gltfRoot.handle.guid);
      roots.set(entity, {
        accent: palette.model,
        icon: 'boxes',
        suffix: location !== undefined ? basename(location) : undefined,
        overridden: hasCompositionOverrides(app, entity),
      });
    }
  }

  return { roots, inherited };
};
