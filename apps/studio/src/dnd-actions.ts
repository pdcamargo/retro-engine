// Drag-and-drop actions, expressed as the editor commands they invoke so a UI
// drop and an AI invocation share one implementation (and one undo/audit path).
// The studio passes `StudioMcp.run` as the RunCommand; the helpers fire-and-forget
// and log failures rather than throwing into an ImGui frame.
import type { Entity } from '@retro-engine/ecs';

/** Invokes an editor command by name; resolves with its result, rejects on failure. */
export type RunCommand = (name: string, args: unknown) => Promise<unknown>;

const warn =
  (what: string) =>
  (err: unknown): void =>
    console.warn(`[studio] ${what} failed`, err);

/** Asset kinds that can be dropped into the scene/hierarchy as a linked instance. */
export const INSTANTIABLE_KINDS: ReadonlySet<string> = new Set(['Scene', 'Prefab', 'Gltf', 'Mesh']);

/**
 * Spawn a linked instance of an asset (scene/prefab/glTF/mesh) by GUID, optionally
 * under a parent and at a world position.
 */
export const instantiateAsset = (
  run: RunCommand,
  guid: string,
  kind: string,
  opts?: { parent?: Entity; position?: readonly [number, number, number] },
): void => {
  void run('asset.instantiate', {
    guid,
    kind,
    ...(opts?.parent !== undefined ? { parent: opts.parent } : {}),
    ...(opts?.position !== undefined ? { position: opts.position } : {}),
  }).catch(warn('asset instantiate'));
};

/** Author a new prefab asset from an entity subtree, optionally into a target dir. */
export const createPrefabFromEntity = (run: RunCommand, entity: Entity, dir?: string): void => {
  void run('prefab.createFromEntity', {
    entity,
    ...(dir !== undefined && dir !== '' ? { dir } : {}),
  }).catch(warn('prefab create'));
};

/** Point an entity's MeshMaterial3d at a material asset by GUID. */
export const applyMaterial = (
  run: RunCommand,
  entity: Entity,
  guid: string,
  materialKind?: string,
): void => {
  void run('material.apply', {
    entity,
    guid,
    ...(materialKind !== undefined ? { materialKind } : {}),
  }).catch(warn('material apply'));
};
