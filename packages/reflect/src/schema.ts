import type { FieldType } from './field-type';

/**
 * The data fields of `T` — every property except methods. Reflection describes
 * data, not behavior, so a component's methods never need a descriptor.
 */
export type Fields<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: T[K];
};

/**
 * A schema for `T`: every data field mapped to a {@link FieldType} of that
 * field's exact type. The `-?` modifier forces every field to be declared —
 * omit one and it is a compile error; describe `health: number` with
 * `t.string` and it is a compile error. Genuinely optional or nullable fields
 * are covered by `.optional()` / `.nullable()` on the field type, which shift
 * the descriptor's static type to match.
 *
 * @example
 * ```ts
 * const schema: Schema<Health> = { current: t.number, max: t.number };
 * ```
 */
export type Schema<T> = {
  [K in keyof Fields<T>]-?: FieldType<Fields<T>[K]>;
};
