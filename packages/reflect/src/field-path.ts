import { type FieldType, t } from './field-type';

/**
 * A single hop from a value root toward a nested value: a named struct/object
 * field, or an array/tuple/vector element by index. The root value itself is
 * identified outside the path (by entity + component type, by asset, …), so a
 * path is always *relative* to one root instance.
 */
export type FieldPathSegment =
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'index'; readonly index: number };

/**
 * A stable address from a value root down to one leaf value. Reused as the read
 * address a tool renders, the write address an edit targets, and the property
 * an animation track drives — so the three never drift apart.
 */
export type FieldPath = readonly FieldPathSegment[];

/**
 * A canonical string for a {@link FieldPath} — used to key coalescing/caching
 * and as the seed for a stable widget id. `field` segments contribute their
 * name, `index` segments a bracketed number, joined by `/` (e.g. `translation/0`).
 */
export const pathKeyOf = (path: FieldPath): string =>
  path.map((seg) => (seg.kind === 'field' ? seg.name : `[${seg.index}]`)).join('/');

const child = (parent: unknown, seg: FieldPathSegment): unknown => {
  if (parent === null || parent === undefined) return undefined;
  return seg.kind === 'field'
    ? (parent as Record<string, unknown>)[seg.name]
    : (parent as Record<number, unknown>)[seg.index];
};

/** Read the value a {@link FieldPath} addresses, starting at `root`. */
export const readPath = (root: unknown, path: FieldPath): unknown => {
  let cursor = root;
  for (const seg of path) cursor = child(cursor, seg);
  return cursor;
};

/**
 * Assign `value` to the leaf a {@link FieldPath} addresses, mutating the object
 * that holds the leaf in place. The root identity is preserved (the same
 * storage cell is mutated), so a `markChanged` hint is the correct way to
 * surface the edit — no archetype move is needed.
 *
 * Throws on an empty path: a path must name at least one segment, since the
 * root instance is not replaced through this function.
 */
export const writePathLeaf = (root: unknown, path: FieldPath, value: unknown): void => {
  if (path.length === 0) throw new Error('reflect: cannot write an empty field path');
  let parent = root;
  for (let i = 0; i < path.length - 1; i++) parent = child(parent, path[i]!);
  if (parent === null || parent === undefined) return;
  const leaf = path[path.length - 1]!;
  if (leaf.kind === 'field') (parent as Record<string, unknown>)[leaf.name] = value;
  else (parent as Record<number, unknown>)[leaf.index] = value;
};

/**
 * Walk a registered type's `schema` along `path` to the {@link FieldType} that
 * describes the addressed leaf, or `undefined` if the path leaves the schema's
 * described shape (a segment names a field the schema does not declare, or
 * indexes a non-container). Lets a caller learn a leaf's {@link FieldType.kind}
 * — and so how to interpret/interpolate it — from the address alone.
 *
 * `index` segments descend through `array` (element type), `tuple` (positional
 * element), and the fixed-width math kinds (`vec*`/`quat`/`mat4`, whose elements
 * are numbers). `field` segments descend through `struct` fields and `type`'s
 * nested constructor schema is *not* followed here (it has no inline `fields`);
 * pass the nested type's own schema to resolve into it.
 */
export const resolveFieldType = (
  schema: Readonly<Record<string, FieldType<unknown>>>,
  path: FieldPath,
): FieldType<unknown> | undefined => {
  if (path.length === 0) return undefined;
  const head = path[0]!;
  if (head.kind !== 'field') return undefined;
  let current: FieldType<unknown> | undefined = schema[head.name];
  for (let i = 1; i < path.length && current !== undefined; i++) {
    current = stepFieldType(current, path[i]!);
  }
  return current;
};

const NUMERIC_ELEMENT_KINDS = new Set(['vec2', 'vec3', 'vec4', 'quat', 'mat4']);

const stepFieldType = (
  ft: FieldType<unknown>,
  seg: FieldPathSegment,
): FieldType<unknown> | undefined => {
  if (seg.kind === 'field') return ft.fields?.[seg.name];
  if (ft.kind === 'array') return ft.element;
  if (ft.kind === 'tuple') return ft.elements?.[seg.index];
  // A component of a fixed-width math value is a number; there is no per-element
  // descriptor, so report `number` so a caller can interpolate the scalar.
  if (NUMERIC_ELEMENT_KINDS.has(ft.kind)) return t.number as FieldType<unknown>;
  return undefined;
};
