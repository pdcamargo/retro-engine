import { type RegisteredType, readField, writeField } from '@retro-engine/reflect';

const isPlainObject = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
};

/**
 * A deep, by-value copy of an editable value, so an edit's before/after snapshot
 * never aliases the value stored on the live component. Driven by the runtime
 * shape rather than a schema:
 *
 * - Primitives (and `null`) are returned as-is.
 * - Typed arrays (the `Float32Array` backing vectors, quaternions, matrices) are
 *   copied — aliasing one would let a later in-place edit corrupt the snapshot.
 * - Plain arrays and plain objects (vectors-as-`{x,y,z}`, colors, anonymous
 *   structs, tagged-union values) are cloned element/field-wise.
 * - Class instances with their own prototype (asset handles, nested registered
 *   types) are kept by identity — they are swapped by reference, never mutated
 *   in place through a leaf edit.
 */
export const snapshotValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return (value as Float32Array).slice();
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = snapshotValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

/**
 * A by-value copy of a whole component instance as a real instance of its class
 * (built through the registered factory, so its prototype and any required
 * fields are intact), with every reflected field deep-copied via
 * {@link snapshotValue}. Used to record add/remove-component edits so the stored
 * instance can be re-inserted on undo/redo without aliasing the history record.
 */
export const snapshotComponent = (registered: RegisteredType, instance: object): object => {
  const copy = registered.make();
  for (const [name] of registered.fields) writeField(copy, name, snapshotValue(readField(instance, name)));
  return copy;
};

/**
 * Structural value equality for snapshots — used to drop no-op edits (a scrub
 * that returns to its starting value records nothing). Compares primitives by
 * `Object.is`, typed arrays / arrays element-wise, and plain objects field-wise.
 */
export const valueEquals = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const av = a as Float32Array;
    const bv = b as Float32Array;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) if (!Object.is(av[i], bv[i])) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => valueEquals(v, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b) || ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => valueEquals(ao[k], bo[k]));
};
