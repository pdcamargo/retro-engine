import type { ComponentType, Entity, World } from '@retro-engine/ecs';
import {
  Children,
  GlobalTransform,
  InheritedVisibility,
  PreviousGlobalTransform,
  ViewVisibility,
} from '@retro-engine/engine';
import type { TypeRegistry } from '@retro-engine/reflect';

/** One component attached to an entity, as surfaced to an inspector. */
export interface ComponentEntry {
  /**
   * Display name. For serializable components this is the stable reflection
   * name; for derived ones it is a best-effort label.
   */
  readonly name: string;
  /**
   * Whether the component has a reflection schema (and thus round-trips through
   * a saved scene). Derived/reciprocal components — recomputed by systems rather
   * than authored — are `false`.
   */
  readonly serializable: boolean;
}

/**
 * Stable display names for the engine's known derived components, which carry no
 * reflection schema (they are recomputed or rebuilt by systems, never authored).
 * Falling back to the constructor name would be unreliable under minification,
 * so the common ones are spelled out.
 */
const DERIVED_NAMES = new Map<ComponentType<object>, string>([
  [GlobalTransform, 'GlobalTransform'],
  [Children, 'Children'],
  [InheritedVisibility, 'InheritedVisibility'],
  [ViewVisibility, 'ViewVisibility'],
  [PreviousGlobalTransform, 'PreviousGlobalTransform'],
]);

/**
 * List the components on an entity, each tagged as serializable (has a
 * reflection schema in `registry`) or derived. Serializable entries come first;
 * both groups are sorted by name for a stable display.
 *
 * An inspector shows the serializable set by default and reveals the derived
 * ones on demand (a debug view) — mirroring the engine's own authored-vs-derived
 * distinction.
 */
export const listComponents = (world: World, registry: TypeRegistry, entity: Entity): ComponentEntry[] => {
  const serializable: ComponentEntry[] = [];
  const derived: ComponentEntry[] = [];
  for (const ctor of world.componentTypesOf(entity)) {
    const reg = registry.getByCtor(ctor);
    if (reg !== undefined) {
      serializable.push({ name: reg.name, serializable: true });
    } else {
      const label = DERIVED_NAMES.get(ctor) ?? ctor.name;
      derived.push({ name: label, serializable: false });
    }
  }
  const byName = (a: ComponentEntry, b: ComponentEntry): number => a.name.localeCompare(b.name);
  serializable.sort(byName);
  derived.sort(byName);
  return [...serializable, ...derived];
};
