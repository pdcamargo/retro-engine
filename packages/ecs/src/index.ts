/** Opaque entity identifier. */
export type Entity = number & { readonly __brand: 'Entity' };

/** Component type marker — a `Symbol` or class constructor that uniquely identifies a component type. */
export type ComponentType<T = unknown> = symbol | (new (...args: never[]) => T);

/** A system is a function invoked each frame against the world. */
export type System = (world: World) => void;

/**
 * Day-1 stub `World`. The real archetype storage and query planner land in a
 * future release; the surface here is the contract systems target.
 */
export class World {
  private nextId = 1;
  private readonly store = new Map<Entity, Map<ComponentType, unknown>>();

  spawn(): Entity {
    const id = this.nextId++ as Entity;
    this.store.set(id, new Map());
    return id;
  }

  despawn(entity: Entity): void {
    this.store.delete(entity);
  }

  addComponent<T>(entity: Entity, type: ComponentType<T>, value: T): void {
    const bag = this.store.get(entity);
    if (bag) bag.set(type, value);
  }

  removeComponent(entity: Entity, type: ComponentType): void {
    this.store.get(entity)?.delete(type);
  }

  getComponent<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    return this.store.get(entity)?.get(type) as T | undefined;
  }

  has(entity: Entity, type: ComponentType): boolean {
    return this.store.get(entity)?.has(type) ?? false;
  }

  /** Iterate every live entity. Real query planner lands later. */
  entities(): IterableIterator<Entity> {
    return this.store.keys();
  }
}
