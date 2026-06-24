import type { Entity, World } from '@retro-engine/ecs';
import { Children, Name, Parent } from '@retro-engine/engine';

import { GltfInstanceNodes } from './gltf-components';

/**
 * A stable, asset-relative address of a node within an instantiated
 * {@link GltfInstanceNodes} subtree — the durable way to reference "the `hand.R`
 * bone" across re-instantiation, since the entity id a node is minted with
 * changes every run.
 *
 * `node` is the glTF node **index**, the canonical identity recorded on save.
 * `path` is the node's **name path** from the model root down to the node
 * (each segment a node `Name`); it is the key preferred at resolve time because
 * it survives node reordering on re-import, where a bare index would not. A node
 * with an unnamed ancestor has no usable path and is addressed by index alone.
 */
export interface GltfNodeAnchor {
  /** glTF node index — the canonical recorded identity. */
  readonly node: number;
  /** Node names from the model root down to the node, when every step is named. */
  readonly path?: readonly string[];
}

/**
 * Resolve a {@link GltfNodeAnchor} against a mount's instantiated subtree to the
 * live node entity, or `undefined` if it cannot be found.
 *
 * Resolution prefers the name `path` (walking from `mount` down its `Children`,
 * matching each segment by `Name` in document order) so it survives a re-import
 * that reorders nodes; it falls back to the node index when there is no path or
 * the walk fails (e.g. a node renamed or removed by a model swap). The index is
 * the canonical identity but the more fragile key across re-export.
 */
export const resolveGltfNodeAnchor = (
  world: World,
  mount: Entity,
  instance: GltfInstanceNodes,
  anchor: GltfNodeAnchor,
): Entity | undefined => {
  if (anchor.path !== undefined && anchor.path.length > 0) {
    const resolved = walkNamePath(world, mount, anchor.path);
    if (resolved !== undefined) return resolved;
  }
  return instance.nodeEntities[anchor.node];
};

/** Descend `mount`'s children matching each `path` segment by `Name`; first match per level. */
const walkNamePath = (world: World, mount: Entity, path: readonly string[]): Entity | undefined => {
  let current = mount;
  for (const segment of path) {
    const children = world.getComponent(current, Children);
    if (children === undefined) return undefined;
    let next: Entity | undefined;
    for (const child of children.entities) {
      if (world.getComponent(child, Name)?.value === segment) {
        next = child;
        break;
      }
    }
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
};

/**
 * Given an entity that lives inside an instantiated glTF subtree, return its
 * mount (the {@link GltfInstanceNodes} root) and a {@link GltfNodeAnchor}
 * addressing it; `undefined` if the entity is not part of any such subtree.
 *
 * Walks up the `Parent` chain to the **nearest** mount, so an entity inside a
 * glTF nested under another glTF anchors to its own model, not the outer one.
 * The name `path` is included only when every node from the mount down to the
 * entity is named (an unnamed step makes the path ambiguous; index addressing
 * still applies).
 */
export const gltfAnchorForEntity = (
  world: World,
  entity: Entity,
): { mount: Entity; anchor: GltfNodeAnchor } | undefined => {
  // Climb to the nearest ancestor carrying an instantiated subtree, recording
  // the names of each step (reversed to root→leaf afterwards).
  const namesLeafToRoot: string[] = [];
  let pathComplete = true;
  let current = entity;
  let mount: Entity | undefined;
  let instance: GltfInstanceNodes | undefined;
  // Bound the walk by world size so a malformed Parent cycle can't spin forever.
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const found = world.getComponent(current, GltfInstanceNodes);
    if (found !== undefined) {
      mount = current;
      instance = found;
      break;
    }
    const name = world.getComponent(current, Name)?.value;
    if (name === undefined) pathComplete = false;
    else namesLeafToRoot.push(name);
    const parent = world.getComponent(current, Parent);
    if (parent === undefined) break;
    current = parent.entity;
  }
  if (mount === undefined || instance === undefined) return undefined;

  const node = instance.nodeEntities.indexOf(entity);
  if (node < 0) return undefined;

  const path = pathComplete ? [...namesLeafToRoot].reverse() : undefined;
  return { mount, anchor: { node, ...(path !== undefined ? { path } : {}) } };
};
