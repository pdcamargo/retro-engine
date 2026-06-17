/**
 * A single hop from a component root toward a nested value: a named field, an
 * array/tuple/vector element by index. The component itself is identified
 * outside the path (by entity + type), so a path is always *relative* to one
 * component instance.
 */
export type FieldPathSegment =
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'index'; readonly index: number };

/**
 * A stable address from a component instance down to one editable value. Used
 * both as the read address an inspector renders and as the write address an
 * edit command targets, so the two never drift apart.
 */
export type FieldPath = readonly FieldPathSegment[];

/**
 * A canonical string for a {@link FieldPath} — used to key coalescing and as the
 * seed for a stable widget id. `field` segments contribute their name, `index`
 * segments a bracketed number, joined by `/` (e.g. `translation/0`).
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
 * that holds the leaf in place. The component root identity is preserved (the
 * same storage cell is mutated), so a `markChanged` hint is the correct way to
 * surface the edit — no archetype move is needed.
 *
 * Throws on an empty path: a path must name at least one segment, since a
 * component instance is not replaced through this function.
 */
export const writePathLeaf = (root: unknown, path: FieldPath, value: unknown): void => {
  if (path.length === 0) throw new Error('editor: cannot write an empty field path');
  let parent = root;
  for (let i = 0; i < path.length - 1; i++) parent = child(parent, path[i]!);
  if (parent === null || parent === undefined) return;
  const leaf = path[path.length - 1]!;
  if (leaf.kind === 'field') (parent as Record<string, unknown>)[leaf.name] = value;
  else (parent as Record<number, unknown>)[leaf.index] = value;
};
