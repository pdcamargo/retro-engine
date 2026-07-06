/**
 * Generic analog input state: a map from a key `T` (a gamepad axis id, an
 * action name) to a scalar value, clamped to a configurable range. Mirrors
 * Bevy's `Axis<T>`.
 *
 * The default range is `[-1, 1]` (the shape of a gamepad stick axis or trigger
 * pair). Values set through {@link Axis.set} are clamped on write; reads return
 * the stored (already-clamped) value, or `undefined` for an axis that has never
 * been set.
 */
export class Axis<T> {
  private readonly values = new Map<T, number>();
  private readonly min: number;
  private readonly max: number;

  constructor(min = -1, max = 1) {
    this.min = min;
    this.max = max;
  }

  /** Set an axis to `value`, clamped to this axis map's range. */
  set(axis: T, value: number): void {
    const clamped = value < this.min ? this.min : value > this.max ? this.max : value;
    this.values.set(axis, clamped);
  }

  /** The value of `axis`, or `undefined` if it has never been set. */
  get(axis: T): number | undefined {
    return this.values.get(axis);
  }

  /** The value of `axis`, or `0` if it has never been set. */
  getOrZero(axis: T): number {
    return this.values.get(axis) ?? 0;
  }

  /** Remove `axis` from the map. Returns whether it was present. */
  remove(axis: T): boolean {
    return this.values.delete(axis);
  }

  /** All axis keys with a stored value. */
  getAll(): IterableIterator<T> {
    return this.values.keys();
  }
}
