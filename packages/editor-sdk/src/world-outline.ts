import type { Entity, World } from '@retro-engine/ecs';
import type { TypeRegistry } from '@retro-engine/reflect';
import {
  Camera,
  DirectionalLight3d,
  Mesh3d,
  Name,
  Parent,
  PointLight3d,
  SceneInstance,
  SceneRoot,
  SpotLight3d,
} from '@retro-engine/engine';

import type { IconName } from './icons';

/**
 * A visual classification for an entity row in an outline: which icon to draw
 * and a coarse kind tag. Produced by an {@link EntityClassifier}.
 */
export interface EntityClass {
  /** Icon to show on the entity's row. */
  readonly icon: IconName;
  /** Coarse kind, e.g. `'camera'`, `'light'`, `'mesh'`, `'scene'`, `'entity'`. */
  readonly kind: string;
}

/**
 * Classifies an entity for display. Return `undefined` to defer to the next
 * classifier in the chain. Classifiers are tried in order and the first match
 * wins, so prepend more specific ones (a host that knows about glTF instances,
 * say) ahead of the defaults.
 */
export type EntityClassifier = (world: World, entity: Entity) => EntityClass | undefined;

/** Fallback used when no classifier matches. */
const DEFAULT_CLASS: EntityClass = { icon: 'circle-dot', kind: 'entity' };

/**
 * Built-in classifiers covering the engine's own component shapes. A consumer
 * with extra component types prepends its own to the chain it passes
 * {@link buildOutline}.
 */
export const defaultClassifiers: readonly EntityClassifier[] = [
  (w, e) => (w.has(e, SceneRoot) || w.has(e, SceneInstance) ? { icon: 'clapperboard', kind: 'scene' } : undefined),
  (w, e) => (w.has(e, Camera) ? { icon: 'video', kind: 'camera' } : undefined),
  (w, e) =>
    w.has(e, DirectionalLight3d) || w.has(e, PointLight3d) || w.has(e, SpotLight3d)
      ? { icon: 'sun', kind: 'light' }
      : undefined,
  (w, e) => (w.has(e, Mesh3d) ? { icon: 'box', kind: 'mesh' } : undefined),
];

const classify = (world: World, entity: Entity, classifiers: readonly EntityClassifier[]): EntityClass => {
  for (const c of classifiers) {
    const result = c(world, entity);
    if (result !== undefined) return result;
  }
  return DEFAULT_CLASS;
};

/** A single, already-flattened row of the entity outline. */
export interface OutlineNode {
  /** The entity this row represents. */
  readonly entity: Entity;
  /** Display name (from a `Name` component, else `Entity <id>`). */
  readonly name: string;
  /** Nesting depth from its root (0 for roots). */
  readonly depth: number;
  /** Whether the entity has at least one child. */
  readonly hasChildren: boolean;
  /**
   * Component count for a badge. When a `registry` is passed to
   * {@link buildOutline} this counts only serializable (authored) components;
   * otherwise it is the total attached count.
   */
  readonly componentCount: number;
  /** Visual classification (icon + kind). */
  readonly class: EntityClass;
}

/** Options for {@link buildOutline}. */
export interface BuildOutlineOptions {
  /**
   * Whether an entity is expanded. When it returns `false`, the entity's
   * children are not emitted (a collapsed subtree). Defaults to always-open.
   */
  readonly isOpen?: (entity: Entity) => boolean;
  /**
   * Whether to omit an entity (and its entire subtree) from the outline.
   * Defaults to skipping nothing.
   */
  readonly skip?: (entity: Entity) => boolean;
  /** Classifier chain; defaults to {@link defaultClassifiers}. */
  readonly classifiers?: readonly EntityClassifier[];
  /**
   * When supplied, each node's `componentCount` counts only serializable
   * (registered) components rather than every attached component.
   */
  readonly registry?: TypeRegistry | undefined;
}

const byId = (a: Entity, b: Entity): number => (a as number) - (b as number);

/**
 * Walk a live world into a flattened, depth-tagged list of entity rows ready to
 * feed a tree widget. The hierarchy is read from the `Parent` edge (the source
 * of truth), so it reflects whatever spawned each entity — authored scenes,
 * prefab expansions, nested scene instances, imported model graphs — uniformly.
 *
 * Roots (entities with no live parent) and each parent's children are ordered by
 * entity id for a stable display across frames. Rebuild it each frame; for small
 * to mid worlds this is cheap.
 */
export const buildOutline = (world: World, opts: BuildOutlineOptions = {}): OutlineNode[] => {
  const isOpen = opts.isOpen ?? ((): boolean => true);
  const skip = opts.skip ?? ((): boolean => false);
  const classifiers = opts.classifiers ?? defaultClassifiers;
  const registry = opts.registry;
  const countOf = (entity: Entity): number => {
    const types = world.componentTypesOf(entity);
    if (registry === undefined) return types.length;
    return types.reduce((n, c) => (registry.getByCtor(c) !== undefined ? n + 1 : n), 0);
  };

  const childrenOf = new Map<Entity, Entity[]>();
  const roots: Entity[] = [];
  for (const entity of world.entities()) {
    const parent = world.getComponent(entity, Parent)?.entity;
    if (parent !== undefined && world.hasEntity(parent)) {
      const siblings = childrenOf.get(parent);
      if (siblings === undefined) childrenOf.set(parent, [entity]);
      else siblings.push(entity);
    } else {
      roots.push(entity);
    }
  }
  roots.sort(byId);
  for (const siblings of childrenOf.values()) siblings.sort(byId);

  const out: OutlineNode[] = [];
  const visit = (entity: Entity, depth: number): void => {
    if (skip(entity)) return;
    const children = childrenOf.get(entity);
    const hasChildren = children !== undefined && children.length > 0;
    out.push({
      entity,
      name: world.getComponent(entity, Name)?.value ?? `Entity ${String(entity)}`,
      depth,
      hasChildren,
      componentCount: countOf(entity),
      class: classify(world, entity, classifiers),
    });
    if (hasChildren && isOpen(entity)) {
      for (const child of children) visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  return out;
};
