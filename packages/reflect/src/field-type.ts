import type { ComponentType, Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { Color } from '@retro-engine/math';
import type { Mat4, Quat, Vec2, Vec3, Vec4 } from 'wgpu-matrix';

/**
 * The discriminant of a {@link FieldType}. A kind captures both *how a value
 * (de)serializes* and *what it means* — `color` is distinct from `vec4` even
 * though both are four numbers, so tooling can render a picker rather than four
 * sliders without guessing from structure.
 */
export type FieldKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'array'
  | 'tuple'
  | 'struct'
  | 'enum'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'quat'
  | 'mat4'
  | 'color'
  | 'entity'
  | 'handle'
  | 'type';

/**
 * Presentational hints attached to a field with {@link FieldType.meta}. Ignored
 * by serialization; read by a future inspector to choose a widget, label, or
 * range. Open-ended on purpose — only differences that change *how a value
 * serializes or its static type* deserve a distinct {@link FieldKind}; anything
 * purely cosmetic belongs here.
 */
export interface FieldMeta {
  /** Human label to show instead of the raw field name. */
  readonly label?: string;
  /** Tooltip / longer description. */
  readonly tooltip?: string;
  /** Hide this field from the inspector. */
  readonly hidden?: boolean;
  /** Inclusive `[min, max]` for numeric widgets. */
  readonly range?: readonly [number, number];
  /** Preferred widget identifier (e.g. `'slider'`, `'multiline'`). */
  readonly widget?: string;
  readonly [key: string]: unknown;
}

interface FieldState {
  readonly kind: FieldKind;
  readonly isOptional: boolean;
  readonly isNullable: boolean;
  readonly isSkipped: boolean;
  readonly defaultFactory: (() => unknown) | undefined;
  readonly hints: FieldMeta | undefined;
  readonly element: FieldType<unknown> | undefined;
  readonly elements: readonly FieldType<unknown>[] | undefined;
  readonly fields: Readonly<Record<string, FieldType<unknown>>> | undefined;
  readonly enumValues: readonly (string | number)[] | undefined;
  readonly assetType: string | undefined;
  readonly nestedCtor: ComponentType<object> | undefined;
}

/**
 * A typed descriptor for one serializable field. The phantom `T` is the field's
 * static type; the runtime data (`kind` plus kind-specific parameters and the
 * modifier flags) drives the codec and is what an inspector introspects.
 *
 * Build descriptors through the {@link t} vocabulary rather than constructing
 * this directly. Modifiers return a fresh descriptor and shift `T`, so a schema
 * stays in sync with the component it describes.
 */
export class FieldType<T> {
  /** Phantom field type. Never present at runtime. */
  declare readonly __type?: T;

  readonly kind: FieldKind;
  /** Value may be `undefined` — encoded as key omission. */
  readonly isOptional: boolean;
  /** Value may be `null` — encoded as JSON `null`. */
  readonly isNullable: boolean;
  /** Excluded from serialization; restored to its constructor default on load. */
  readonly isSkipped: boolean;
  /** Produces a value when the field is absent on load. */
  readonly defaultFactory: (() => unknown) | undefined;
  /** Inspector hints; ignored by the codec. */
  readonly hints: FieldMeta | undefined;
  /** Element descriptor for `array`. */
  readonly element: FieldType<unknown> | undefined;
  /** Element descriptors for `tuple`, positional. */
  readonly elements: readonly FieldType<unknown>[] | undefined;
  /** Field descriptors for `struct`, keyed by field name. */
  readonly fields: Readonly<Record<string, FieldType<unknown>>> | undefined;
  /** Allowed values for `enum`. */
  readonly enumValues: readonly (string | number)[] | undefined;
  /** Asset store name for `handle`, used by the injected resolver. */
  readonly assetType: string | undefined;
  /** Constructor of the nested registered type for `type`. */
  readonly nestedCtor: ComponentType<object> | undefined;

  constructor(state: FieldState) {
    this.kind = state.kind;
    this.isOptional = state.isOptional;
    this.isNullable = state.isNullable;
    this.isSkipped = state.isSkipped;
    this.defaultFactory = state.defaultFactory;
    this.hints = state.hints;
    this.element = state.element;
    this.elements = state.elements;
    this.fields = state.fields;
    this.enumValues = state.enumValues;
    this.assetType = state.assetType;
    this.nestedCtor = state.nestedCtor;
  }

  private clone<U>(patch: Partial<FieldState>): FieldType<U> {
    return new FieldType<U>({ ...this, ...patch });
  }

  /** Allow `undefined`; the field is omitted from output when unset. */
  optional(): FieldType<T | undefined> {
    return this.clone<T | undefined>({ isOptional: true });
  }

  /** Allow `null`; encoded as JSON `null`. */
  nullable(): FieldType<T | null> {
    return this.clone<T | null>({ isNullable: true });
  }

  /** Allow both `null` and `undefined`. */
  nullish(): FieldType<T | null | undefined> {
    return this.clone<T | null | undefined>({ isOptional: true, isNullable: true });
  }

  /** Exclude from serialization; the constructor default is kept on load. */
  skip(): FieldType<T> {
    return this.clone<T>({ isSkipped: true });
  }

  /** Supply a value to use when the field is absent on load. */
  default(make: () => T): FieldType<T> {
    return this.clone<T>({ defaultFactory: make });
  }

  /** Attach inspector hints, merged over any already present. */
  meta(attrs: FieldMeta): FieldType<T> {
    return this.clone<T>({ hints: { ...this.hints, ...attrs } });
  }
}

const base = (kind: FieldKind, extra?: Partial<FieldState>): FieldState => ({
  kind,
  isOptional: false,
  isNullable: false,
  isSkipped: false,
  defaultFactory: undefined,
  hints: undefined,
  element: undefined,
  elements: undefined,
  fields: undefined,
  enumValues: undefined,
  assetType: undefined,
  nestedCtor: undefined,
  ...extra,
});

type InferTuple<E extends readonly FieldType<unknown>[]> = {
  [K in keyof E]: E[K] extends FieldType<infer U> ? U : never;
};

type InferStruct<S extends Record<string, FieldType<unknown>>> = {
  [K in keyof S]: S[K] extends FieldType<infer U> ? U : never;
};

/**
 * The field-type vocabulary. Each entry produces a {@link FieldType} whose
 * static type matches the value it describes, so a schema typed against a
 * component catches a missing, renamed, or mistyped field at compile time.
 *
 * @example
 * ```ts
 * registerComponent(Transform, {
 *   translation: t.vec3,
 *   rotation: t.quat,
 *   scale: t.vec3,
 * });
 * ```
 */
export const t = {
  /** A JSON number. */
  number: new FieldType<number>(base('number')),
  /** A JSON string. */
  string: new FieldType<string>(base('string')),
  /** A JSON boolean. */
  boolean: new FieldType<boolean>(base('boolean')),
  /** A 2-component float vector (`Float32Array`). */
  vec2: new FieldType<Vec2>(base('vec2')),
  /** A 3-component float vector (`Float32Array`). */
  vec3: new FieldType<Vec3>(base('vec3')),
  /** A 4-component float vector (`Float32Array`). */
  vec4: new FieldType<Vec4>(base('vec4')),
  /** A quaternion (`Float32Array`). */
  quat: new FieldType<Quat>(base('quat')),
  /** A column-major 4x4 matrix (`Float32Array`). */
  mat4: new FieldType<Mat4>(base('mat4')),
  /** An sRGB color `{ r, g, b, a }`. Distinct from `vec4` so tooling renders a picker. */
  color: new FieldType<Color>(base('color')),

  /** A homogeneous array of `of`. */
  array<E>(of: FieldType<E>): FieldType<E[]> {
    return new FieldType<E[]>(base('array', { element: of }));
  },

  /** A fixed-length, positionally-typed tuple. */
  tuple<E extends readonly FieldType<unknown>[]>(...ofs: E): FieldType<InferTuple<E>> {
    return new FieldType<InferTuple<E>>(base('tuple', { elements: ofs }));
  },

  /** An anonymous object shape, reconstructed as a plain object. */
  struct<S extends Record<string, FieldType<unknown>>>(fields: S): FieldType<InferStruct<S>> {
    return new FieldType<InferStruct<S>>(base('struct', { fields }));
  },

  /** One of a fixed set of string literals. */
  enum<V extends string>(...values: V[]): FieldType<V> {
    return new FieldType<V>(base('enum', { enumValues: values }));
  },

  /** A reference to another entity, remapped through the deserialize context. */
  entity(): FieldType<Entity> {
    return new FieldType<Entity>(base('entity'));
  },

  /**
   * A reference to an asset. `assetType` names the target store so the injected
   * resolver can reconstruct the handle on load.
   */
  handle<A>(assetType: string): FieldType<Handle<A>> {
    return new FieldType<Handle<A>>(base('handle', { assetType }));
  },

  /**
   * A nested value that is itself a registered type, reconstructed as that
   * class via its registered factory. Use {@link t.struct} for anonymous shapes
   * and `t.type` for class instances that compose.
   */
  type<C extends ComponentType<object>>(ctor: C): FieldType<InstanceType<C>> {
    return new FieldType<InstanceType<C>>(base('type', { nestedCtor: ctor }));
  },
} as const;
