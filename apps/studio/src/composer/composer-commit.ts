import {
  type App,
  AppBundleRegistry,
  AppTypeRegistry,
  type BundleDefinition,
  encodeBundleComponents,
  Name,
} from '@retro-engine/engine';
import type { Entity } from '@retro-engine/ecs';
import { type CustomCommand, type History, snapshotComponent } from '@retro-engine/editor-sdk';

import type { ComposerCatalog } from './composer-catalog';
import type { Composition, ComposerState } from './composer-state';

/** What the composer needs to commit, plus host callbacks for selection and bundle persistence. */
export interface ComposerCommitDeps {
  readonly app: App;
  readonly history: History;
  readonly state: ComposerState;
  readonly catalog: ComposerCatalog;
  readonly composition: Composition;
  /** Select the newly spawned entity (create mode). */
  readonly select: (entity: Entity) => void;
  /** Persist a bundle definition to a `.rebundle` asset (bundle mode); resolves when written. */
  readonly saveBundle?: (
    def: BundleDefinition,
    guid: string | null,
    location: string | null,
  ) => Promise<void>;
}

/** The instances (cloned from drafts) plus their registered types, in commit order. */
const builtComponents = (deps: ComposerCommitDeps): { name: string; instance: object }[] => {
  const out: { name: string; instance: object }[] = [];
  for (const name of deps.composition.newNames) {
    const instance = deps.state.drafts.get(name);
    if (instance !== undefined) out.push({ name, instance });
  }
  return out;
};

/**
 * Run the composer's action for its mode:
 * - **add** → one undoable {@link AddBundleCommand} that inserts every new component.
 * - **create** → an undoable spawn of a fresh entity (reserved id, so undo/redo is stable),
 *   named from the name field, then selected.
 * - **bundle** → encode the drafts into a {@link BundleDefinition}, register it, and (when a
 *   `saveBundle` host callback is provided) write the `.rebundle` asset; returns that promise.
 */
export const composerCommit = (deps: ComposerCommitDeps): void | Promise<void> => {
  const { app, history, state } = deps;

  if (state.mode === 'add') {
    const entity = state.targetEntity;
    if (entity === null || !app.world.hasEntity(entity)) return;
    const components = builtComponents(deps);
    if (components.length === 0) return;
    history.apply({
      kind: 'addBundle',
      entity,
      bundleName: 'components',
      label: `Add ${components.length} component${components.length === 1 ? '' : 's'}`,
      components,
    });
    return;
  }

  if (state.mode === 'create') {
    const built = builtComponents(deps);
    if (built.length === 0) return;
    const regOf = (name: string) => deps.catalog.byName.get(name)?.reg;
    const id = app.world.reserveEntity();
    const entityName = state.entityName.trim();
    const cmd: CustomCommand = {
      kind: 'custom',
      entity: id,
      componentName: '',
      label: `Spawn ${entityName.length > 0 ? entityName : 'Entity'}`,
      apply: (world) => {
        const instances: object[] = [];
        for (const c of built) {
          const reg = regOf(c.name);
          if (reg !== undefined) instances.push(snapshotComponent(reg, c.instance));
        }
        if (entityName.length > 0 && !built.some((c) => c.name === 'Name')) {
          instances.push(new Name(entityName));
        }
        world.spawnReserved(id, instances);
      },
      revert: (world) => {
        if (world.hasEntity(id)) world.despawn(id);
      },
    };
    history.apply(cmd);
    deps.select(id);
    return;
  }

  // bundle mode
  const registry = app.getResource(AppTypeRegistry)!.registry;
  const instances = builtComponents(deps).map((c) => c.instance);
  const def: BundleDefinition = {
    name: state.bundleName.trim().length > 0 ? state.bundleName.trim() : 'Bundle',
    components: encodeBundleComponents(registry, instances),
  };
  app.getResource(AppBundleRegistry)!.register(def);
  return deps.saveBundle?.(def, state.bundleAssetGuid, state.bundleAssetLocation);
};
