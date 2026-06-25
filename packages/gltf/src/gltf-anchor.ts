import type { Entity, World } from '@retro-engine/ecs';
import { Children, Name, Parent } from '@retro-engine/engine';

import { GltfInstanceNodes } from './gltf-components';

/**
 * A stable, asset-relative address of an entity within an instantiated
 * {@link GltfInstanceNodes} subtree — the durable way to reference "the `hand.R`
 * bone" across re-instantiation, since the entity id a node is minted with
 * changes every run.
 *
 * `node` is the glTF node **index**, the canonical identity recorded on save.
 * `path` is the node's **name path** from the model root down to the node
 * (each segment a node `Name`); it is the key preferred at resolve time because
 * it survives node reordering on re-import, where a bare index would not. A node
 * with an unnamed ancestor has no usable path and is addressed by index alone.
 *
 * `primitive` addresses a sub-entity a node spawns for a multi-primitive mesh
 * (one child per primitive, none of which is a glTF node and so has no index of
 * its own): the anchor points at the owning node, then selects the primitive-th
 * mesh child in document order.
 */
export interface GltfNodeAnchor {
  /** glTF node index — the canonical recorded identity. */
  readonly node: number;
  /** Node names from the model root down to the node, when every step is named. */
  readonly path?: readonly string[];
  /** Mesh-child ordinal under the node, for a multi-primitive node's per-primitive entity. */
  readonly primitive?: number;
}

/**
 * Resolve a {@link GltfNodeAnchor} against a mount's instantiated subtree to the
 * live entity, or `undefined` if it cannot be found.
 *
 * Resolution prefers the name `path` (walking from `mount` down its `Children`,
 * matching each segment by `Name` in document order) so it survives a re-import
 * that reorders nodes; it falls back to the node index when there is no path or
 * the walk fails (e.g. a node renamed or removed by a model swap). The index is
 * the canonical identity but the more fragile key across re-export. When the
 * anchor names a `primitive`, the resolved node's primitive-th mesh child (a
 * derived, non-node child in document order) is returned.
 */
export const resolveGltfNodeAnchor = (
  world: World,
  mount: Entity,
  instance: GltfInstanceNodes,
  anchor: GltfNodeAnchor,
): Entity | undefined => {
  let node: Entity | undefined;
  if (anchor.path !== undefined && anchor.path.length > 0) {
    node = walkNamePath(world, mount, anchor.path);
  }
  if (node === undefined) node = instance.nodeEntities[anchor.node];
  if (anchor.primitive === undefined || node === undefined) return node;
  return primitiveChild(world, instance, node, anchor.primitive);
};

/** The `primitive`-th derived, non-node child of `node` in document order. */
const primitiveChild = (
  world: World,
  instance: GltfInstanceNodes,
  node: Entity,
  primitive: number,
): Entity | undefined => {
  const children = world.getComponent(node, Children);
  if (children === undefined) return undefined;
  let count = 0;
  for (const child of children.entities) {
    if (instance.nodeEntities.indexOf(child) >= 0) continue; // a child node, not a primitive
    if (!instance.derivedEntities.has(child)) continue; // an authored attachment
    if (count === primitive) return child;
    count += 1;
  }
  return undefined;
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

/** The nearest ancestor (or self) carrying an instantiated subtree, with that subtree's record. */
const findMount = (
  world: World,
  entity: Entity,
): { mount: Entity; instance: GltfInstanceNodes } | undefined => {
  let current = entity;
  // Bound the walk by world size so a malformed Parent cycle can't spin forever.
  for (let guard = 0; guard < 1_000_000; guard += 1) {
    const instance = world.getComponent(current, GltfInstanceNodes);
    if (instance !== undefined) return { mount: current, instance };
    const parent = world.getComponent(current, Parent);
    if (parent === undefined) return undefined;
    current = parent.entity;
  }
  return undefined;
};

/** Names from `mount`'s child down to `node`, root→leaf, or `undefined` if any step is unnamed. */
const namePathTo = (world: World, mount: Entity, node: Entity): readonly string[] | undefined => {
  const namesLeafToRoot: string[] = [];
  let current = node;
  while (current !== mount) {
    const name = world.getComponent(current, Name)?.value;
    if (name === undefined) return undefined;
    namesLeafToRoot.push(name);
    const parent = world.getComponent(current, Parent);
    if (parent === undefined) return undefined; // chain broke before reaching the mount
    current = parent.entity;
  }
  return namesLeafToRoot.reverse();
};

/**
 * Given an entity that lives inside an instantiated glTF subtree, return its
 * mount (the {@link GltfInstanceNodes} root) and a {@link GltfNodeAnchor}
 * addressing it; `undefined` if the entity is not part of any such subtree.
 *
 * Walks up the `Parent` chain to the **nearest** mount, so an entity inside a
 * glTF nested under another glTF anchors to its own model, not the outer one. A
 * node entity anchors by index (plus its name `path` when every ancestor is
 * named); a per-primitive mesh child anchors to its owning node plus its
 * `primitive` ordinal.
 */
export const gltfAnchorForEntity = (
  world: World,
  entity: Entity,
): { mount: Entity; anchor: GltfNodeAnchor } | undefined => {
  const found = findMount(world, entity);
  if (found === undefined) return undefined;
  const { mount, instance } = found;

  const node = instance.nodeEntities.indexOf(entity);
  if (node >= 0) {
    const path = namePathTo(world, mount, entity);
    return { mount, anchor: { node, ...(path !== undefined ? { path } : {}) } };
  }

  // Not a node — only a derived per-primitive mesh child can still be anchored;
  // an authored attachment is serialized as an ordinary entity instead.
  if (!instance.derivedEntities.has(entity)) return undefined;
  const parent = world.getComponent(entity, Parent)?.entity;
  if (parent === undefined) return undefined;
  const parentNode = instance.nodeEntities.indexOf(parent);
  if (parentNode < 0) return undefined;

  const siblings = world.getComponent(parent, Children);
  if (siblings === undefined) return undefined;
  let primitive = -1;
  let count = 0;
  for (const child of siblings.entities) {
    if (instance.nodeEntities.indexOf(child) >= 0) continue;
    if (!instance.derivedEntities.has(child)) continue;
    if (child === entity) {
      primitive = count;
      break;
    }
    count += 1;
  }
  if (primitive < 0) return undefined;

  const path = namePathTo(world, mount, parent);
  return { mount, anchor: { node: parentNode, primitive, ...(path !== undefined ? { path } : {}) } };
};
