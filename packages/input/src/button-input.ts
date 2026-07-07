/**
 * Generic per-frame button state for any discrete input `T` (a key code, a
 * mouse button, a gamepad button). Tracks three sets:
 *
 * - **pressed** — currently held down, from a press until its release.
 * - **justPressed** — pressed *this frame*; true for exactly one frame.
 * - **justReleased** — released *this frame*; true for exactly one frame.
 *
 * The owning system calls {@link ButtonInput.clear} once per frame (before
 * applying that frame's events) to drop the two transient sets while keeping
 * the held set — so `justPressed` / `justReleased` describe only the current
 * frame. This mirrors Bevy's `ButtonInput<T>`.
 *
 * `T` should be a value type with meaningful `===` identity (string literals,
 * numbers) since state is keyed in a `Set<T>`.
 */
export class ButtonInput<T> {
  private readonly _pressed = new Set<T>();
  private readonly _justPressed = new Set<T>();
  private readonly _justReleased = new Set<T>();
  private readonly _repeated = new Set<T>();

  /**
   * Register a press. Adds to the held set and — only if the input was not
   * already held — to the just-pressed set, so key-repeat events do not re-fire
   * `justPressed`. Pass `repeat: true` for an auto-repeat event (a held key's
   * OS-cadence re-fire): it lands in the repeated set (see {@link repeated}) and
   * never re-fires `justPressed`.
   */
  press(input: T, repeat = false): void {
    if (repeat) this._repeated.add(input);
    if (!this._pressed.has(input)) {
      this._pressed.add(input);
      if (!repeat) this._justPressed.add(input);
    }
  }

  /**
   * Register a release. Removes from the held set and — only if the input was
   * actually held — adds to the just-released set.
   */
  release(input: T): void {
    if (this._pressed.delete(input)) {
      this._justReleased.add(input);
    }
  }

  /** Release every currently-held input, marking each just-released. */
  releaseAll(): void {
    for (const input of this._pressed) this._justReleased.add(input);
    this._pressed.clear();
  }

  /** Whether `input` is currently held down. */
  pressed(input: T): boolean {
    return this._pressed.has(input);
  }

  /** Whether any of `inputs` is currently held down. */
  anyPressed(inputs: Iterable<T>): boolean {
    for (const input of inputs) if (this._pressed.has(input)) return true;
    return false;
  }

  /** Whether every one of `inputs` is currently held down. */
  allPressed(inputs: Iterable<T>): boolean {
    for (const input of inputs) if (!this._pressed.has(input)) return false;
    return true;
  }

  /** Whether `input` was pressed this frame. */
  justPressed(input: T): boolean {
    return this._justPressed.has(input);
  }

  /** Whether any of `inputs` was pressed this frame. */
  anyJustPressed(inputs: Iterable<T>): boolean {
    for (const input of inputs) if (this._justPressed.has(input)) return true;
    return false;
  }

  /**
   * Whether `input` fired an auto-repeat this frame (a held key's OS-cadence
   * re-fire). Distinct from `justPressed` (which fires only on the initial
   * press); use `justPressed || repeated` for "act now, then repeat while held"
   * behavior — see {@link justPressedOrRepeated}.
   */
  repeated(input: T): boolean {
    return this._repeated.has(input);
  }

  /** Whether `input` was pressed this frame or fired an auto-repeat — the "act now, then repeat" test. */
  justPressedOrRepeated(input: T): boolean {
    return this._justPressed.has(input) || this._repeated.has(input);
  }

  /** Whether `input` was released this frame. */
  justReleased(input: T): boolean {
    return this._justReleased.has(input);
  }

  /** Whether any of `inputs` was released this frame. */
  anyJustReleased(inputs: Iterable<T>): boolean {
    for (const input of inputs) if (this._justReleased.has(input)) return true;
    return false;
  }

  /** All currently-held inputs. */
  getPressed(): IterableIterator<T> {
    return this._pressed.values();
  }

  /** All inputs pressed this frame. */
  getJustPressed(): IterableIterator<T> {
    return this._justPressed.values();
  }

  /** All inputs released this frame. */
  getJustReleased(): IterableIterator<T> {
    return this._justReleased.values();
  }

  /** All inputs that fired an auto-repeat this frame. */
  getRepeated(): IterableIterator<T> {
    return this._repeated.values();
  }

  /**
   * Clear the transient sets (`justPressed`, `justReleased`, `repeated`) while
   * leaving the held set intact. Called once per frame before that frame's
   * events are applied.
   */
  clear(): void {
    this._justPressed.clear();
    this._justReleased.clear();
    this._repeated.clear();
  }

  /**
   * Forget a single input entirely — remove it from every set. Use to consume an
   * input so later systems in the same frame do not also react to it.
   */
  reset(input: T): void {
    this._pressed.delete(input);
    this._justPressed.delete(input);
    this._justReleased.delete(input);
    this._repeated.delete(input);
  }

  /** Forget every input across all sets. */
  resetAll(): void {
    this._pressed.clear();
    this._justPressed.clear();
    this._justReleased.clear();
    this._repeated.clear();
  }
}
