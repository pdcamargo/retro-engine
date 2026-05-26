import type { ComponentType, Entity } from './types';
import type { World } from './world';

/**
 * Filter clauses for {@link World.query}.
 *
 * - `with` — archetype must contain every listed component.
 * - `without` — archetype must contain none of the listed components.
 * - `has` — does not affect archetype matching; appends one boolean per entry
 *   to each yielded row, in declaration order, indicating whether the row's
 *   archetype carries that component.
 * - `changed` — gate-only filter. The row's archetype must contain every
 *   listed type and each type's `changedTick` must be strictly greater than
 *   the query's `sinceTick`. Does not affect row shape.
 * - `added` — gate-only filter. The row's archetype must contain every
 *   listed type and each type's `addedTick` must be strictly greater than
 *   the query's `sinceTick`. By construction every operation that bumps
 *   `addedTick` also bumps `changedTick`, so `added` ⟹ `changed`.
 *   Does not affect row shape.
 */
export interface QueryFilters {
  readonly with?: readonly ComponentType[];
  readonly without?: readonly ComponentType[];
  readonly has?: readonly ComponentType[];
  readonly changed?: readonly ComponentType[];
  readonly added?: readonly ComponentType[];
}

type InstanceOf<C> = C extends new (...args: never[]) => infer V ? V : never;
type InstancesOf<Ts extends readonly ComponentType[]> = {
  -readonly [K in keyof Ts]: InstanceOf<Ts[K]>;
};
type HasFlagsOf<F extends QueryFilters | undefined> = F extends { has: infer H }
  ? H extends readonly ComponentType[]
    ? { -readonly [K in keyof H]: boolean }
    : []
  : [];

/** Tuple yielded by iterating a {@link Query}. */
export type QueryRow<
  Ts extends readonly ComponentType[],
  F extends QueryFilters | undefined,
> = [...InstancesOf<Ts>, ...HasFlagsOf<F>];

/** Tuple yielded by {@link Query.entries} — the row prefixed with its entity id. */
export type QueryEntry<
  Ts extends readonly ComponentType[],
  F extends QueryFilters | undefined,
> = [Entity, ...QueryRow<Ts, F>];

/**
 * Read-only handle over the rows matching a query. Iterate with `for...of`,
 * or call {@link Query.first}, {@link Query.single}, {@link Query.count}.
 *
 * Iteration order within an archetype is row order (broken by swap-remove);
 * order across archetypes is unspecified. Mutating component data through the
 * yielded instances is safe; structural mutations (add/remove/despawn) during
 * iteration are undefined behavior — defer them via a future `Commands`.
 *
 * `sinceTick` scopes the optional `changed` / `added` filter clauses; the
 * engine's `Query` param wires the calling system's pre-run tick snapshot
 * here automatically. Direct callers default to `0` ("no scoping" — every
 * tick column is above zero after its first write).
 */
export class Query<
  Ts extends readonly ComponentType[],
  F extends QueryFilters | undefined = undefined,
> {
  constructor(
    private readonly world: World,
    private readonly types: Ts,
    private readonly filters: F | undefined,
    private readonly sinceTick: number = 0,
  ) {}

  *[Symbol.iterator](): IterableIterator<QueryRow<Ts, F>> {
    yield* this.world.iterateQuery(this.types, this.filters, this.sinceTick);
  }

  /**
   * Iterate matching rows together with their entity ids. Each yielded tuple
   * starts with the row's `Entity`, followed by the same components and
   * `has`-flag booleans `for...of` on this query would yield.
   *
   * Use this when the system needs the entity id — for example to look up an
   * adjacent component, schedule a deferred mutation through `Commands`, or
   * key auxiliary state by entity. The standard iterator stays component-only
   * so most call sites do not pay for an extra tuple slot they would not use.
   *
   * @example
   * ```ts
   * for (const [entity, transform] of world.query([Transform]).entries()) {
   *   cmd.entity(entity).insert(new Marker());
   * }
   * ```
   */
  *entries(): IterableIterator<QueryEntry<Ts, F>> {
    yield* this.world.iterateQueryEntries(this.types, this.filters, this.sinceTick);
  }

  /**
   * Non-allocating counterpart to {@link entries}: invokes `cb` once per
   * matching row with the same `[Entity, ...components, ...has-flags]` tuple,
   * but **reuses a single row buffer** across all rows — no per-row array, no
   * generator. The hot path for systems that touch every entity each frame.
   *
   * The tuple is **transient**: read what you need inside the callback; do not
   * store or close over it past the call (it is overwritten on the next row).
   * If a row must outlive iteration, use {@link entries} (which allocates a
   * fresh tuple per row) or copy the values out.
   *
   * @example
   * ```ts
   * world.query([Transform, ViewVisibility]).forEach((entry) => {
   *   const transform = entry[1] as Transform;
   *   // ...read now; don't retain `entry`.
   * });
   * ```
   */
  forEach(cb: (entry: QueryEntry<Ts, F>) => void): void {
    this.world.forEachEntry(this.types, this.filters, this.sinceTick, cb);
  }

  /** First matching row, or `undefined` if no rows match. */
  first(): QueryRow<Ts, F> | undefined {
    for (const row of this) return row;
    return undefined;
  }

  /** Throws unless exactly one row matches. Returns that row. */
  single(): QueryRow<Ts, F> {
    let found: QueryRow<Ts, F> | undefined;
    let count = 0;
    for (const row of this) {
      count += 1;
      if (count === 1) {
        found = row;
      } else {
        throw new Error(
          'ecs: Query.single() — expected exactly one match, got at least 2',
        );
      }
    }
    if (count === 0) {
      throw new Error('ecs: Query.single() — expected exactly one match, got 0');
    }
    return found!;
  }

  /** Number of rows the query yields. Iterates the matched archetypes. */
  count(): number {
    let n = 0;
    for (const _row of this) n += 1;
    return n;
  }
}
