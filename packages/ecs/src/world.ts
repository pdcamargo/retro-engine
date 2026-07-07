import type { ColumnEntry } from './archetype';
import { Archetype, archetypeKeyOf, resolveBundle } from './archetype';
import { isAddedSince, isChangedSince, writeChangedTick, type RemovedEntry } from './change-detection';
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
 * an archetype with parallel columns of component data plus two side-by-side
 * tick columns per component (last-mutation and first-added). Queries iterate
 * only matching archetypes.
 *
 * Structural changes (add/remove component) move the entity row between
 * archetypes via swap-remove; row order within an archetype is not preserved
 * across removals.
 *
 * **Change-detection model.** The world advances a monotonic `changeTick` on
 * every structural mutation and on every {@link World.markChanged} call.
 * Storage carries two tick columns per component: `changedTick` (bumped on
 * mutation, including in-place via {@link World.markChanged}) and `addedTick`
 * (bumped only when the component is newly attached to an entity, preserved
 * across archetype transitions). Component removals are buffered in
 * {@link World.takeRemovedComponents} and drained at frame boundary by the
 * scheduler.
 *
 * Queries gate rows on `changed` / `added` filter clauses by comparing the
 * row's tick column entries to a `sinceTick` threshold supplied by the
 * caller — typically the calling system's last-seen tick, captured by the
 * scheduler before the system runs.
 */
export class World {
  private nextEntityId = 1;
  private tickCounter = 0;
  private readonly archetypeByKey = new Map<string, Archetype>();
  private readonly entityIndex = new Map<Entity, EntityLocation>();
  private readonly removedBuffer = new Map<ComponentType, RemovedEntry[]>();

  constructor() {
    this.archetypeByKey.set(EMPTY_ARCHETYPE_KEY, new Archetype(new Set()));
  }

  /**
   * Monotonic mutation tick. Advances on every structural mutation
   * (`spawn`, `insertBundle`, `removeComponent`, `despawn`) and on every
   * {@link World.markChanged} call. Read by the scheduler to snapshot each
   * system's observation window; consumer code rarely needs to read it
   * directly.
   */
  get changeTick(): number {
    return this.tickCounter;
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
   *
   * Every component on the new row is tagged with `addedTick = changedTick =
   * <fresh tick>`; subsequent `Added<T>` and `Changed<T>` filters see the
   * new row as both added and changed.
   */
  spawnReserved(entity: Entity, components: readonly object[]): void {
    if (this.entityIndex.has(entity)) {
      throw new Error(`ecs: cannot spawn already-live entity ${entity}`);
    }
    const tick = this.bumpTick();
    if (components.length === 0) {
      const empty = this.archetypeByKey.get(EMPTY_ARCHETYPE_KEY)!;
      const row = empty.push(entity, new Map());
      this.entityIndex.set(entity, { archetype: empty, row });
      return;
    }
    const resolved = resolveBundle(components);
    const archetype = this.getOrCreateArchetype(new Set(resolved.keys()));
    const entries = freshEntries(resolved, tick);
    const row = archetype.push(entity, entries);
    this.entityIndex.set(entity, { archetype, row });
  }

  /**
   * Despawn an entity. Silent if the entity is already gone.
   *
   * Each component the entity carried at despawn time is pushed into the
   * removed buffer with the current mutation tick; systems with the
   * `RemovedComponents<T>` param can observe the removal until the buffer
   * is drained at frame boundary.
   */
  despawn(entity: Entity): void {
    const loc = this.entityIndex.get(entity);
    if (!loc) return;
    const tick = this.bumpTick();
    for (const t of loc.archetype.types) {
      this.pushRemoved(t, entity, tick);
    }
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
   * archetype, the cells are overwritten in place (no archetype transition)
   * and their `changedTick` bumps while `addedTick` is preserved (replace
   * semantics); otherwise the entity moves to a new archetype carrying the
   * union of types. On a transition:
   *
   * - Components retained from the old archetype preserve both ticks.
   * - Components newly added to the entity receive `addedTick = changedTick =
   *   <fresh tick>`.
   * - Components present in both the old archetype and the bundle (user
   *   explicitly re-inserted) bump `changedTick` while preserving `addedTick`.
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
    const tick = this.bumpTick();
    if (!needsTransition) {
      for (const [t, v] of resolved) {
        loc.archetype.columns.get(t)![loc.row] = v;
        loc.archetype.changedTickColumns.get(t)![loc.row] = tick;
      }
      return;
    }

    const newTypes = new Set<ComponentType>(loc.archetype.typeSet);
    for (const t of resolved.keys()) newTypes.add(t);

    const entries = new Map<ComponentType, ColumnEntry>();
    for (const t of loc.archetype.types) {
      const oldRow = loc.row;
      const oldAdded = loc.archetype.addedTickColumns.get(t)![oldRow]!;
      const oldChanged = loc.archetype.changedTickColumns.get(t)![oldRow]!;
      if (resolved.has(t)) {
        // Component is present in both old archetype and bundle — user
        // re-inserted by value. Bump changedTick; preserve addedTick.
        entries.set(t, {
          value: resolved.get(t),
          addedTick: oldAdded,
          changedTick: tick,
        });
      } else {
        // Carried over unchanged.
        entries.set(t, {
          value: loc.archetype.columns.get(t)![oldRow],
          addedTick: oldAdded,
          changedTick: oldChanged,
        });
      }
    }
    for (const [t, v] of resolved) {
      if (!loc.archetype.typeSet.has(t)) {
        // Newly added to entity.
        entries.set(t, { value: v, addedTick: tick, changedTick: tick });
      }
    }

    const target = this.getOrCreateArchetype(newTypes);
    const moved = loc.archetype.swapRemove(loc.row);
    if (moved !== undefined) {
      this.entityIndex.get(moved)!.row = loc.row;
    }
    const newRow = target.push(entity, entries);
    this.entityIndex.set(entity, { archetype: target, row: newRow });
  }

  /**
   * Remove a component from an entity. Silent if the entity does not carry
   * the component. Removing a Required dependency does not cascade to its
   * requirers — the requirer is left in an inconsistent state and the caller
   * is responsible for any cleanup.
   *
   * The removed `(entity, type)` pair is pushed into the removed buffer with
   * the current mutation tick. Components retained on the entity preserve
   * both their tick columns across the archetype move.
   */
  removeComponent(entity: Entity, type: ComponentType): void {
    const loc = this.entityIndex.get(entity);
    if (!loc) return;
    if (!loc.archetype.typeSet.has(type)) return;
    const tick = this.bumpTick();
    this.pushRemoved(type, entity, tick);
    const newTypes = new Set<ComponentType>(loc.archetype.typeSet);
    newTypes.delete(type);

    const entries = new Map<ComponentType, ColumnEntry>();
    for (const t of loc.archetype.types) {
      if (t === type) continue;
      const oldRow = loc.row;
      entries.set(t, {
        value: loc.archetype.columns.get(t)![oldRow],
        addedTick: loc.archetype.addedTickColumns.get(t)![oldRow]!,
        changedTick: loc.archetype.changedTickColumns.get(t)![oldRow]!,
      });
    }

    const target = this.getOrCreateArchetype(newTypes);
    const moved = loc.archetype.swapRemove(loc.row);
    if (moved !== undefined) {
      this.entityIndex.get(moved)!.row = loc.row;
    }
    const newRow = target.push(entity, entries);
    this.entityIndex.set(entity, { archetype: target, row: newRow });
  }

  /**
   * Hint that a component has been mutated in place. Bumps `world.changeTick`
   * and writes the new tick into the component's `changedTick` column so
   * `Changed<T>` filters see the row on subsequent observations.
   *
   * Silent no-op when the entity is not live or does not carry `type` —
   * mutation hints are too fragile to throw on, and a missing component is
   * typically a sign that the entity has already moved on by the time the
   * hint fires.
   *
   * `addedTick` is **not** touched: a long-lived component that mutates is
   * `Changed`, not `Added`.
   *
   * @example
   * ```ts
   * for (const [pos] of world.query([Position])) {
   *   pos.x += 1;
   *   world.markChanged(entity, Position);
   * }
   * ```
   */
  markChanged(entity: Entity, type: ComponentType): void {
    const loc = this.entityIndex.get(entity);
    if (!loc) return;
    if (!loc.archetype.typeSet.has(type)) return;
    writeChangedTick(loc.archetype, type, loc.row, this.bumpTick());
  }

  /**
   * Advance the mutation tick by one and return the new value. Used by
   * engine-layer machinery that needs a strictly-increasing tick stamp without
   * touching any archetype column or pushing a removed entry — notably the
   * message-channel buffer, which stamps each write with a fresh tick so
   * readers' `lastSeenTick > entry.tick` filter eliminates the missed-message
   * edge case when a system writes messages but does no structural mutations.
   *
   * Does not touch `addedTickColumns` or `changedTickColumns`; component
   * `Added<T>` / `Changed<T>` filters are unaffected by calls here. The tick
   * counter is a JavaScript `Number` (safe to 2^53), so realistic event rates
   * do not approach saturation.
   */
  advanceTick(): number {
    return this.bumpTick();
  }

  /** Look up a component on an entity. `undefined` when the entity lacks it. */
  getComponent<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    const loc = this.entityIndex.get(entity);
    if (!loc) return undefined;
    if (!loc.archetype.typeSet.has(type as ComponentType)) return undefined;
    return loc.archetype.columns.get(type as ComponentType)![loc.row] as T;
  }

  /**
   * The component classes currently attached to `entity`. Returns the
   * entity's archetype type list (an empty array if the entity is not live).
   * Used by engine-layer machinery that needs to enumerate components for
   * dispatch — notably the commands flush's per-component `onRemove` fan-out
   * at despawn time.
   *
   * The returned array is a live reference to the archetype's internal type
   * list; do not mutate it.
   *
   * @internal
   */
  componentTypesOf(entity: Entity): readonly ComponentType[] {
    const loc = this.entityIndex.get(entity);
    if (!loc) return [];
    return loc.archetype.types;
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

  /**
   * Number of live entities, in O(1). A reserved id not yet allocated via
   * {@link World.spawnReserved} does not count until it is live.
   */
  get entityCount(): number {
    return this.entityIndex.size;
  }

  /** Builder bound to `entity` for chained insert/remove/despawn. */
  entity(entity: Entity): EntityRef {
    return new EntityRef(this, entity);
  }

  /**
   * Build a {@link Query} over the given component types with optional
   * filters. The returned handle is iterable and exposes
   * {@link Query.single}, {@link Query.first}, {@link Query.count}.
   *
   * `sinceTick` scopes the optional `changed` / `added` filter clauses: a
   * row matches a `changed` filter for component `T` iff
   * `T.changedTick > sinceTick`. Defaults to `0`, which means "see all"
   * (every tick column starts above zero after its first write). The engine's
   * `Query(...)` param wires the calling system's pre-run tick snapshot here
   * automatically; direct callers pass nothing for "no change-filter scoping."
   */
  query<
    const Ts extends readonly ComponentType[],
    F extends QueryFilters | undefined = undefined,
  >(types: Ts, filters?: F, sinceTick = 0): Query<Ts, F> {
    return new Query(this, types, filters, sinceTick);
  }

  /**
   * Read the current `removedBuffer` slice for `type` without draining it.
   * Used by the engine's `RemovedComponents<T>` param when resolving on a
   * per-system basis; the buffer drains at frame boundary via
   * {@link World.drainRemovedBuffer}, not on read.
   *
   * @internal
   */
  getRemovedComponents(type: ComponentType): readonly RemovedEntry[] {
    return this.removedBuffer.get(type) ?? [];
  }

  /**
   * Clear every `removedBuffer` entry. Called by the scheduler at frame
   * boundary so the v1 frame-buffered contract holds: a removal observed in
   * frame F is not observable in frame F+1.
   *
   * @internal
   */
  drainRemovedBuffer(): void {
    this.removedBuffer.clear();
  }

  /**
   * Despawn every live entity, drain the removed-component buffer, and reset
   * the entity-id counter to 1.
   *
   * Intended for ephemeral worlds that are rebuilt each frame from external
   * data — most notably the render world (ADR-0019). Per-component
   * lifecycle hooks and entity-targeted observers DO fire for each cleared
   * row, mirroring `despawn`; the `removedBuffer` is drained at the end so
   * the next frame starts with a clean slate.
   *
   * Main `World` instances normally do not call this — gameplay code relies
   * on entity ids persisting across frames. Calling it on the main world is
   * the explicit equivalent of "tear down the game and start over."
   */
  clearAllEntities(): void {
    const entities = Array.from(this.entityIndex.keys());
    for (const entity of entities) this.despawn(entity);
    this.drainRemovedBuffer();
    this.nextEntityId = 1;
  }

  /**
   * @internal Iterator backend used by {@link Query.[Symbol.iterator]}.
   */
  *iterateQuery<
    const Ts extends readonly ComponentType[],
    F extends QueryFilters | undefined,
  >(
    types: Ts,
    filters: F | undefined,
    sinceTick: number,
  ): IterableIterator<QueryRow<Ts, F>> {
    const hasFilter = filters?.has;
    const changedFilter = filters?.changed;
    const addedFilter = filters?.added;
    const explicitDisabled = filters?.with?.includes(Disabled) ?? false;

    for (const archetype of this.archetypeByKey.values()) {
      if (!this.archetypeMatches(archetype, types, filters, explicitDisabled)) continue;

      const cols: unknown[][] = types.map((t) => archetype.columns.get(t)!);
      const hasFlags = hasFilter ? hasFilter.map((t) => archetype.typeSet.has(t)) : [];
      const rowCount = archetype.entities.length;
      const ncols = cols.length;
      const nflags = hasFlags.length;
      for (let r = 0; r < rowCount; r++) {
        if (changedFilter && !this.rowPassesChanged(archetype, changedFilter, r, sinceTick)) {
          continue;
        }
        if (addedFilter && !this.rowPassesAdded(archetype, addedFilter, r, sinceTick)) {
          continue;
        }
        const row: unknown[] = [];
        for (let i = 0; i < ncols; i++) row.push(cols[i]![r]);
        for (let j = 0; j < nflags; j++) row.push(hasFlags[j]);
        yield row as QueryRow<Ts, F>;
      }
    }
  }

  /**
   * Archetype-level match test shared by every query backend: the archetype
   * must be non-empty, respect the `Disabled` opt-in, contain every queried
   * type, satisfy `with` / `without`, and (for `changed` / `added`) contain
   * each gated type. Per-row tick checks happen separately.
   */
  private archetypeMatches(
    archetype: Archetype,
    types: readonly ComponentType[],
    filters: QueryFilters | undefined,
    explicitDisabled: boolean,
  ): boolean {
    if (archetype.entities.length === 0) return false;
    if (!explicitDisabled && archetype.typeSet.has(Disabled)) return false;
    for (const t of types) if (!archetype.typeSet.has(t)) return false;
    if (filters === undefined) return true;
    if (filters.with) for (const t of filters.with) if (!archetype.typeSet.has(t)) return false;
    if (filters.without) for (const t of filters.without) if (archetype.typeSet.has(t)) return false;
    if (filters.changed) for (const t of filters.changed) if (!archetype.typeSet.has(t)) return false;
    if (filters.added) for (const t of filters.added) if (!archetype.typeSet.has(t)) return false;
    return true;
  }

  /**
   * @internal Entity-augmented iterator backend used by {@link Query.entries}.
   * Mirrors {@link World.iterateQuery} but prefixes each yielded tuple with
   * the row's `Entity`.
   */
  *iterateQueryEntries<
    const Ts extends readonly ComponentType[],
    F extends QueryFilters | undefined,
  >(
    types: Ts,
    filters: F | undefined,
    sinceTick: number,
  ): IterableIterator<QueryEntry<Ts, F>> {
    const hasFilter = filters?.has;
    const changedFilter = filters?.changed;
    const addedFilter = filters?.added;
    const explicitDisabled = filters?.with?.includes(Disabled) ?? false;

    for (const archetype of this.archetypeByKey.values()) {
      if (!this.archetypeMatches(archetype, types, filters, explicitDisabled)) continue;

      const cols: unknown[][] = types.map((t) => archetype.columns.get(t)!);
      const hasFlags = hasFilter ? hasFilter.map((t) => archetype.typeSet.has(t)) : [];
      const entities = archetype.entities;
      const rowCount = entities.length;
      const ncols = cols.length;
      const nflags = hasFlags.length;
      for (let r = 0; r < rowCount; r++) {
        if (changedFilter && !this.rowPassesChanged(archetype, changedFilter, r, sinceTick)) {
          continue;
        }
        if (addedFilter && !this.rowPassesAdded(archetype, addedFilter, r, sinceTick)) {
          continue;
        }
        const row: unknown[] = [entities[r]!];
        for (let i = 0; i < ncols; i++) row.push(cols[i]![r]);
        for (let j = 0; j < nflags; j++) row.push(hasFlags[j]);
        yield row as QueryEntry<Ts, F>;
      }
    }
  }

  /**
   * Non-allocating entity-augmented iteration backend used by
   * {@link Query.forEach}. Same matched rows as {@link iterateQueryEntries},
   * but reuses one row buffer across every row and invokes `cb` instead of
   * yielding — no per-row array, no generator. The row passed to `cb` is
   * **transient**: read it within the callback; never retain it (it is
   * overwritten on the next row). Use {@link iterateQueryEntries} when a row
   * must outlive the iteration.
   *
   * @internal
   */
  forEachEntry<const Ts extends readonly ComponentType[], F extends QueryFilters | undefined>(
    types: Ts,
    filters: F | undefined,
    sinceTick: number,
    cb: (entry: QueryEntry<Ts, F>) => void,
  ): void {
    const hasFilter = filters?.has;
    const changedFilter = filters?.changed;
    const addedFilter = filters?.added;
    const explicitDisabled = filters?.with?.includes(Disabled) ?? false;
    const ncols = types.length;
    const nflags = hasFilter?.length ?? 0;
    const row: unknown[] = Array.from({ length: 1 + ncols + nflags }); // reused across all rows

    for (const archetype of this.archetypeByKey.values()) {
      if (!this.archetypeMatches(archetype, types, filters, explicitDisabled)) continue;

      const cols: unknown[][] = types.map((t) => archetype.columns.get(t)!);
      const hasFlags = hasFilter ? hasFilter.map((t) => archetype.typeSet.has(t)) : [];
      const entities = archetype.entities;
      const rowCount = entities.length;
      for (let r = 0; r < rowCount; r++) {
        if (changedFilter && !this.rowPassesChanged(archetype, changedFilter, r, sinceTick)) {
          continue;
        }
        if (addedFilter && !this.rowPassesAdded(archetype, addedFilter, r, sinceTick)) {
          continue;
        }
        row[0] = entities[r]!;
        for (let i = 0; i < ncols; i++) row[i + 1] = cols[i]![r];
        for (let j = 0; j < nflags; j++) row[1 + ncols + j] = hasFlags[j]!;
        cb(row as unknown as QueryEntry<Ts, F>);
      }
    }
  }

  private rowPassesChanged(
    archetype: Archetype,
    types: readonly ComponentType[],
    row: number,
    sinceTick: number,
  ): boolean {
    for (const t of types) {
      if (!isChangedSince(archetype, t, row, sinceTick)) return false;
    }
    return true;
  }

  private rowPassesAdded(
    archetype: Archetype,
    types: readonly ComponentType[],
    row: number,
    sinceTick: number,
  ): boolean {
    for (const t of types) {
      if (!isAddedSince(archetype, t, row, sinceTick)) return false;
    }
    return true;
  }

  private pushRemoved(type: ComponentType, entity: Entity, tick: number): void {
    let bucket = this.removedBuffer.get(type);
    if (!bucket) {
      bucket = [];
      this.removedBuffer.set(type, bucket);
    }
    bucket.push({ entity, tick });
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

const freshEntries = (
  values: ReadonlyMap<ComponentType, unknown>,
  tick: number,
): Map<ComponentType, ColumnEntry> => {
  const out = new Map<ComponentType, ColumnEntry>();
  for (const [t, v] of values) {
    out.set(t, { value: v, addedTick: tick, changedTick: tick });
  }
  return out;
};
