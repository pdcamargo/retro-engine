import { Archetype, archetypeKeyOf, resolveBundle } from './archetype';
import { Query, type QueryEntry, type QueryFilters, type QueryRow } from './query';
import { Disabled, type ComponentType, type Entity } from './types';

interface EntityLocation {
  archetype: Archetype;
  row: number;
}

const EMPTY_ARCHETYPE_KEY = '';

/**
 * Builder handle returned by {@link World.entity}. Mutating methods are
 * chainable; {@link EntityRef.despawn} terminates the chain.
 */
export class EntityRef {
  constructor(
    private readonly world: World,
    /** Underlying entity id. */
    readonly id: Entity,
  ) {}

  /**
   * Insert one or more components on the entity. Required-component
   * dependencies of each inserted component are auto-filled with their default
   * constructors if not already present.
   */
  insert(...components: object[]): this {
    if (components.length === 0) return this;
    this.world.insertBundle(this.id, components);
    return this;
  }

  /** Remove one or more components by class. Silent if a component is absent. */
  remove(...types: ComponentType[]): this {
    for (const t of types) this.world.removeComponent(this.id, t);
    return this;
  }

  /** Look up a component by class; `undefined` when the entity lacks it. */
  get<T>(type: ComponentType<T>): T | undefined {
    return this.world.getComponent(this.id, type);
  }

  /** Whether the entity carries a component of the given class. */
  has(type: ComponentType): boolean {
    return this.world.has(this.id, type);
  }

  /** Despawn the entity. */
  despawn(): void {
    this.world.despawn(this.id);
  }
}

/**
 * Archetype-graph world. Entities are opaque IDs; each unique component set is
 * an archetype with parallel columns of component data plus a side-by-side
 * column of last-mutation ticks (the tick columns are wired now so future
 * change-detection filters can read them without re-storaging). Queries
 * iterate only matching archetypes.
 *
 * Structural changes (add/remove component) move the entity row between
 * archetypes via swap-remove; row order within an archetype is not preserved
 * across removals.
 */
export class World {
  private nextEntityId = 1;
  private tickCounter = 0;
  private readonly archetypeByKey = new Map<string, Archetype>();
  private readonly entityIndex = new Map<Entity, EntityLocation>();

  constructor() {
    this.archetypeByKey.set(EMPTY_ARCHETYPE_KEY, new Archetype(new Set()));
  }

  /**
   * Spawn an entity with zero or more components. Accepts components as
   * variadic instances or as a single array bundle:
   *
   * ```ts
   * world.spawn();
   * world.spawn(new Position());
   * world.spawn(new Position(), new Velocity());
   * world.spawn([new Position(), new Velocity()]);
   * ```
   *
   * Components declared on `static requires` are resolved transitively and
   * auto-inserted with their default constructor before the archetype is
   * looked up.
   */
  spawn(...components: ReadonlyArray<object | readonly object[]>): Entity {
    const flat: object[] = [];
    for (const c of components) {
      if (Array.isArray(c)) flat.push(...c);
      else flat.push(c as object);
    }
    const id = this.reserveEntity();
    this.spawnReserved(id, flat);
    return id;
  }

  /**
   * Mint a fresh entity id without allocating storage. The returned id is not
   * yet known to queries or to `has` / `getComponent` — pair with
   * {@link World.spawnReserved} to allocate the row at a later, possibly
   * non-adjacent, call site.
   *
   * Intended for deferred-spawn buffers that need an entity id at enqueue time
   * so subsequent enqueued mutations can target it. Most code should call
   * {@link World.spawn} instead, which composes `reserveEntity` and
   * `spawnReserved` and returns the id ready to use.
   *
   * A reserved id that is never passed to `spawnReserved` simply leaks — entity
   * ids are not recycled.
   */
  reserveEntity(): Entity {
    return this.nextEntityId++ as Entity;
  }

  /**
   * Allocate archetype storage for a previously-reserved entity id and insert
   * the bundle. Throws if the id is already live (i.e. has storage). The
   * bundle accepts a flat readonly array of component instances; callers that
   * need the variadic-or-array surface should use {@link World.spawn}.
   *
   * Components declared on `static requires` are resolved transitively and
   * auto-inserted with their default constructor before the archetype is
   * looked up — same semantics as `spawn`.
   */
  spawnReserved(entity: Entity, components: readonly object[]): void {
    if (this.entityIndex.has(entity)) {
      throw new Error(`ecs: cannot spawn already-live entity ${entity}`);
    }
    if (components.length === 0) {
      const empty = this.archetypeByKey.get(EMPTY_ARCHETYPE_KEY)!;
      const row = empty.push(entity, new Map(), this.bumpTick());
      this.entityIndex.set(entity, { archetype: empty, row });
      return;
    }
    const resolved = resolveBundle(components);
    const archetype = this.getOrCreateArchetype(new Set(resolved.keys()));
    const row = archetype.push(entity, resolved, this.bumpTick());
    this.entityIndex.set(entity, { archetype, row });
  }

  /** Despawn an entity. Silent if the entity is already gone. */
  despawn(entity: Entity): void {
    const loc = this.entityIndex.get(entity);
    if (!loc) return;
    const moved = loc.archetype.swapRemove(loc.row);
    if (moved !== undefined) {
      this.entityIndex.get(moved)!.row = loc.row;
    }
    this.entityIndex.delete(entity);
  }

  /**
   * Insert one component on an existing entity. `type` is preserved in the
   * signature for ergonomic call sites; the underlying archetype key is
   * `value.constructor`, so passing a value of a different class than `type`
   * stores under the value's class.
   *
   * Equivalent to `entity(e).insert(value)`.
   */
  addComponent<T extends object>(entity: Entity, _type: ComponentType<T>, value: T): void {
    this.insertBundle(entity, [value]);
  }

  /**
   * Insert a bundle of components on an existing entity. Runs Required-
   * component resolution at the bundle boundary, skipping dependencies that
   * are already present on the entity.
   *
   * If every component in the resolved bundle is already part of the entity's
   * archetype, the cells are overwritten in place (no archetype transition);
   * otherwise the entity moves to a new archetype carrying the union of types.
   */
  insertBundle(entity: Entity, components: readonly object[]): void {
    const loc = this.entityIndex.get(entity);
    if (!loc) {
      throw new Error(`ecs: cannot insert on unknown entity ${entity}`);
    }
    const resolved = resolveBundle(components, loc.archetype.typeSet);

    let needsTransition = false;
    for (const t of resolved.keys()) {
      if (!loc.archetype.typeSet.has(t)) {
        needsTransition = true;
        break;
      }
    }
    if (!needsTransition) {
      const tick = this.bumpTick();
      for (const [t, v] of resolved) {
        loc.archetype.columns.get(t)![loc.row] = v;
        loc.archetype.tickColumns.get(t)![loc.row] = tick;
      }
      return;
    }

    const newTypes = new Set<ComponentType>(loc.archetype.typeSet);
    for (const t of resolved.keys()) newTypes.add(t);

    const merged = new Map<ComponentType, unknown>();
    for (const t of loc.archetype.types) {
      merged.set(t, loc.archetype.columns.get(t)![loc.row]);
    }
    for (const [t, v] of resolved) merged.set(t, v);

    const target = this.getOrCreateArchetype(newTypes);
    const moved = loc.archetype.swapRemove(loc.row);
    if (moved !== undefined) {
      this.entityIndex.get(moved)!.row = loc.row;
    }
    const newRow = target.push(entity, merged, this.bumpTick());
    this.entityIndex.set(entity, { archetype: target, row: newRow });
  }

  /**
   * Remove a component from an entity. Silent if the entity does not carry
   * the component. Removing a Required dependency does not cascade to its
   * requirers — the requirer is left in an inconsistent state and the caller
   * is responsible for any cleanup.
   */
  removeComponent(entity: Entity, type: ComponentType): void {
    const loc = this.entityIndex.get(entity);
    if (!loc) return;
    if (!loc.archetype.typeSet.has(type)) return;
    const newTypes = new Set<ComponentType>(loc.archetype.typeSet);
    newTypes.delete(type);

    const merged = new Map<ComponentType, unknown>();
    for (const t of loc.archetype.types) {
      if (t === type) continue;
      merged.set(t, loc.archetype.columns.get(t)![loc.row]);
    }

    const target = this.getOrCreateArchetype(newTypes);
    const moved = loc.archetype.swapRemove(loc.row);
    if (moved !== undefined) {
      this.entityIndex.get(moved)!.row = loc.row;
    }
    const newRow = target.push(entity, merged, this.bumpTick());
    this.entityIndex.set(entity, { archetype: target, row: newRow });
  }

  /** Look up a component on an entity. `undefined` when the entity lacks it. */
  getComponent<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    const loc = this.entityIndex.get(entity);
    if (!loc) return undefined;
    if (!loc.archetype.typeSet.has(type as ComponentType)) return undefined;
    return loc.archetype.columns.get(type as ComponentType)![loc.row] as T;
  }

  /** Whether the entity carries the given component class. */
  has(entity: Entity, type: ComponentType): boolean {
    const loc = this.entityIndex.get(entity);
    if (!loc) return false;
    return loc.archetype.typeSet.has(type);
  }

  /**
   * Whether the entity is currently live — spawned and not yet despawned. A
   * reserved id that has not yet been allocated via {@link World.spawnReserved}
   * is not live and returns `false`.
   */
  hasEntity(entity: Entity): boolean {
    return this.entityIndex.has(entity);
  }

  /** Iterate every live entity ID. Order is not specified. */
  *entities(): IterableIterator<Entity> {
    for (const a of this.archetypeByKey.values()) {
      for (const e of a.entities) yield e;
    }
  }

  /** Builder bound to `entity` for chained insert/remove/despawn. */
  entity(entity: Entity): EntityRef {
    return new EntityRef(this, entity);
  }

  /**
   * Build a {@link Query} over the given component types with optional
   * filters. The returned handle is iterable and exposes
   * {@link Query.single}, {@link Query.first}, {@link Query.count}.
   */
  query<
    const Ts extends readonly ComponentType[],
    F extends QueryFilters | undefined = undefined,
  >(types: Ts, filters?: F): Query<Ts, F> {
    return new Query(this, types, filters);
  }

  /**
   * @internal Iterator backend used by {@link Query.[Symbol.iterator]}.
   */
  *iterateQuery<
    const Ts extends readonly ComponentType[],
    F extends QueryFilters | undefined,
  >(types: Ts, filters: F | undefined): IterableIterator<QueryRow<Ts, F>> {
    const withFilter = filters?.with;
    const withoutFilter = filters?.without;
    const hasFilter = filters?.has;
    const explicitDisabled = withFilter?.includes(Disabled) ?? false;

    for (const archetype of this.archetypeByKey.values()) {
      if (archetype.entities.length === 0) continue;
      if (!explicitDisabled && archetype.typeSet.has(Disabled)) continue;

      let matches = true;
      for (const t of types) {
        if (!archetype.typeSet.has(t)) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;

      if (withFilter) {
        for (const t of withFilter) {
          if (!archetype.typeSet.has(t)) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      if (withoutFilter) {
        for (const t of withoutFilter) {
          if (archetype.typeSet.has(t)) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      const cols: unknown[][] = types.map((t) => archetype.columns.get(t)!);
      const hasFlags = hasFilter ? hasFilter.map((t) => archetype.typeSet.has(t)) : [];
      const rowCount = archetype.entities.length;
      const ncols = cols.length;
      const nflags = hasFlags.length;
      for (let r = 0; r < rowCount; r++) {
        const row: unknown[] = [];
        for (let i = 0; i < ncols; i++) row.push(cols[i]![r]);
        for (let j = 0; j < nflags; j++) row.push(hasFlags[j]);
        yield row as QueryRow<Ts, F>;
      }
    }
  }

  /**
   * @internal Entity-augmented iterator backend used by {@link Query.entries}.
   * Mirrors {@link World.iterateQuery} but prefixes each yielded tuple with
   * the row's `Entity`.
   */
  *iterateQueryEntries<
    const Ts extends readonly ComponentType[],
    F extends QueryFilters | undefined,
  >(types: Ts, filters: F | undefined): IterableIterator<QueryEntry<Ts, F>> {
    const withFilter = filters?.with;
    const withoutFilter = filters?.without;
    const hasFilter = filters?.has;
    const explicitDisabled = withFilter?.includes(Disabled) ?? false;

    for (const archetype of this.archetypeByKey.values()) {
      if (archetype.entities.length === 0) continue;
      if (!explicitDisabled && archetype.typeSet.has(Disabled)) continue;

      let matches = true;
      for (const t of types) {
        if (!archetype.typeSet.has(t)) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;

      if (withFilter) {
        for (const t of withFilter) {
          if (!archetype.typeSet.has(t)) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      if (withoutFilter) {
        for (const t of withoutFilter) {
          if (archetype.typeSet.has(t)) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      const cols: unknown[][] = types.map((t) => archetype.columns.get(t)!);
      const hasFlags = hasFilter ? hasFilter.map((t) => archetype.typeSet.has(t)) : [];
      const entities = archetype.entities;
      const rowCount = entities.length;
      const ncols = cols.length;
      const nflags = hasFlags.length;
      for (let r = 0; r < rowCount; r++) {
        const row: unknown[] = [entities[r]!];
        for (let i = 0; i < ncols; i++) row.push(cols[i]![r]);
        for (let j = 0; j < nflags; j++) row.push(hasFlags[j]);
        yield row as QueryEntry<Ts, F>;
      }
    }
  }

  private getOrCreateArchetype(types: ReadonlySet<ComponentType>): Archetype {
    const key = archetypeKeyOf(types);
    let a = this.archetypeByKey.get(key);
    if (!a) {
      a = new Archetype(types);
      this.archetypeByKey.set(key, a);
    }
    return a;
  }

  private bumpTick(): number {
    this.tickCounter += 1;
    return this.tickCounter;
  }
}
