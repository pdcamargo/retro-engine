/** Opaque entity identifier. */
export type Entity = number & { readonly __brand: 'Entity' };

/**
 * Component type identifier — a class constructor that uniquely identifies a
 * component type. The lenient `never[]` parameter list lets any constructor
 * (with or without arguments) satisfy the alias; default-constructibility for
 * Required Components is a separate runtime check at insertion time.
 */
export type ComponentType<T = object> = new (...args: never[]) => T;

const componentIds = new WeakMap<ComponentType, number>();
let nextComponentId = 1;

/**
 * Returns a stable monotonic integer identifier for a component class. The
 * first call for a given class mints a fresh ID; subsequent calls return the
 * same value. Used by the engine's Query token interner to build stable cache
 * keys; consumer code generally has no need for this.
 *
 * @internal
 */
export const componentId = (ctor: ComponentType): number => {
  let id = componentIds.get(ctor);
  if (id === undefined) {
    id = nextComponentId++;
    componentIds.set(ctor, id);
  }
  return id;
};

/**
 * Marker component. Entities carrying it are excluded from queries by default;
 * pass `{ with: [Disabled] }` in the query filter to include only disabled
 * entities, or `{ without: [Disabled] }` to make the default exclusion
 * explicit.
 */
export class Disabled {}
