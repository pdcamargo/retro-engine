import type { ComponentType } from '@retro-engine/ecs';

import type { FieldType } from './field-type';
import type { Schema } from './schema';

/**
 * Upgrades serialized data from version `to - 1` to version `to`. Migrations
 * for a type are applied in ascending `to` order until the registered version
 * is reached, so a file written long ago lands at the current shape one step at
 * a time.
 */
export interface Migration {
  /** The version this migration produces. */
  readonly to: number;
  /** Transform data of version `to - 1` into version `to`. */
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/** Options for {@link TypeRegistry.registerType} / {@link TypeRegistry.registerComponent}. */
export interface RegisterOptions<T> {
  /**
   * Stable name to key this type by. Defaults to the class name (`ctor.name`).
   * Pass an explicit name to namespace it (e.g. `"mygame/Player"`) or to keep
   * the serialized name fixed across a future class rename. Required only for
   * anonymous classes, whose `ctor.name` is empty.
   */
  readonly name?: string;
  /** Schema version of the current shape. Defaults to `1`. */
  readonly version?: number;
  /** Ordered upgraders run when loading older data. */
  readonly migrations?: readonly Migration[];
  /** Factory for a default instance on load. Defaults to `() => new Ctor()`. */
  readonly make?: () => T;
}

/** A type registered with a {@link TypeRegistry}: its stable name, schema, and how to construct it. */
export interface RegisteredType<T = object> {
  /** The stable name this type is keyed by. */
  readonly name: string;
  /** The constructor this schema describes. */
  readonly ctor: ComponentType<T>;
  /** Current schema version. */
  readonly version: number;
  /** Field descriptors keyed by field name, in declaration order. */
  readonly schema: Readonly<Record<string, FieldType<unknown>>>;
  /** Field descriptors as ordered `[name, type]` pairs, for introspection. */
  readonly fields: ReadonlyArray<readonly [string, FieldType<unknown>]>;
  /** Ordered upgraders for older serialized data. */
  readonly migrations: readonly Migration[];
  /** Whether this type may be attached to an entity as a component. */
  readonly attachable: boolean;
  /** Construct a default instance to decode onto. */
  make(): T;
}

const resolveName = (ctor: ComponentType<object>, explicit: string | undefined): string => {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const fromStatic = (ctor as unknown as { readonly typeName?: unknown }).typeName;
  if (typeof fromStatic === 'string' && fromStatic.length > 0) return fromStatic;
  if (ctor.name.length > 0) return ctor.name;
  throw new Error(
    'reflect: cannot register an anonymous class without a stable name — pass { name }.',
  );
};

/**
 * A set of registered types keyed by stable name. The serializer reads it to
 * turn a live world into data and back; a future inspector reads it to draw a
 * field editor per registered type.
 */
export class TypeRegistry {
  private readonly byName = new Map<string, RegisteredType>();
  private readonly byCtor = new Map<ComponentType<object>, RegisteredType>();

  /** Register any value type. Use {@link TypeRegistry.registerComponent} for entity-attachable types. */
  registerType<T extends object>(
    ctor: ComponentType<T>,
    schema: Schema<T>,
    opts: RegisterOptions<T> = {},
  ): RegisteredType<T> {
    return this.register(ctor, schema, opts, false);
  }

  /** Register a component — a value type that may be attached to an entity. */
  registerComponent<T extends object>(
    ctor: ComponentType<T>,
    schema: Schema<T>,
    opts: RegisterOptions<T> = {},
  ): RegisteredType<T> {
    return this.register(ctor, schema, opts, true);
  }

  private register<T extends object>(
    ctor: ComponentType<T>,
    schema: Schema<T>,
    opts: RegisterOptions<T>,
    attachable: boolean,
  ): RegisteredType<T> {
    const name = resolveName(ctor, opts.name);
    const collision = this.byName.get(name);
    if (collision !== undefined && collision.ctor !== (ctor as ComponentType<object>)) {
      throw new Error(`reflect: type name '${name}' is already registered to a different constructor`);
    }
    const fields = Object.entries(schema as Record<string, FieldType<unknown>>);
    const entry: RegisteredType<T> = {
      name,
      ctor,
      version: opts.version ?? 1,
      schema: schema as Record<string, FieldType<unknown>>,
      fields,
      migrations: opts.migrations ?? [],
      attachable,
      make: opts.make ?? (() => new ctor()),
    };
    this.byName.set(name, entry as RegisteredType);
    this.byCtor.set(ctor as ComponentType<object>, entry as RegisteredType);
    return entry;
  }

  /** Look up a registered type by its stable name. */
  get(name: string): RegisteredType | undefined {
    return this.byName.get(name);
  }

  /** Look up a registered type by its constructor. */
  getByCtor(ctor: ComponentType<object>): RegisteredType | undefined {
    return this.byCtor.get(ctor);
  }

  /** Whether a type is registered under `name`. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Every registered type, in registration order. */
  *types(): IterableIterator<RegisteredType> {
    yield* this.byName.values();
  }

  /** Every registered component (attachable type), in registration order. */
  *components(): IterableIterator<RegisteredType> {
    for (const entry of this.byName.values()) {
      if (entry.attachable) yield entry;
    }
  }
}

/** The process-wide registry used by the free {@link registerType} / {@link registerComponent} helpers. */
export const defaultRegistry = new TypeRegistry();

/** Register a value type in the {@link defaultRegistry}. */
export const registerType = <T extends object>(
  ctor: ComponentType<T>,
  schema: Schema<T>,
  opts?: RegisterOptions<T>,
): RegisteredType<T> => defaultRegistry.registerType(ctor, schema, opts);

/** Register a component in the {@link defaultRegistry}. */
export const registerComponent = <T extends object>(
  ctor: ComponentType<T>,
  schema: Schema<T>,
  opts?: RegisterOptions<T>,
): RegisteredType<T> => defaultRegistry.registerComponent(ctor, schema, opts);

/** Read a field value off an instance by name. Companion to {@link RegisteredType.fields}. */
export const readField = (instance: object, field: string): unknown =>
  (instance as Record<string, unknown>)[field];

/** Write a field value onto an instance by name. */
export const writeField = (instance: object, field: string, value: unknown): void => {
  (instance as Record<string, unknown>)[field] = value;
};
