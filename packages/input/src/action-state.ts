/** A resolved 2D axis value. */
export interface Axis2dValue {
  readonly x: number;
  readonly y: number;
}

/**
 * The resolved per-frame state of an entity's {@link ActionMap}, read by name.
 * A **derived** component — recomputed every frame from the device inputs and
 * never serialized (its values are transient). Auto-attached as a Required
 * Component of `ActionMap`.
 *
 * Edge queries (`justPressed` / `justReleased`) are computed against the
 * previous frame's snapshot, so an action stays "held" while *any* of its bound
 * inputs is held (many-to-many bindings resolve correctly).
 *
 * @example
 * ```ts
 * app.addSystem('update', [Query([ActionState])], (rows) => {
 *   for (const [actions] of rows) {
 *     if (actions.justPressed('Jump')) jump();
 *     const move = actions.axis2d('Move');
 *     translate(move.x, move.y);
 *   }
 * });
 * ```
 */
export class ActionState {
  /** @internal Current held state per action. Written by `resolveActionState`. */
  readonly pressedMap = new Map<string, boolean>();
  /** @internal Held state as of the previous frame, for edge detection. */
  readonly prevPressedMap = new Map<string, boolean>();
  /** @internal Scalar value per action (`axis`: [-1,1]; `button`: 1/0). */
  readonly valueMap = new Map<string, number>();
  /** @internal 2D value per `axis2d` action. */
  readonly vec2Map = new Map<string, Axis2dValue>();

  /** Whether `name` is currently held (any bound input down, or axis ≠ 0). */
  pressed(name: string): boolean {
    return this.pressedMap.get(name) ?? false;
  }

  /** Whether `name` became held this frame. */
  justPressed(name: string): boolean {
    return (this.pressedMap.get(name) ?? false) && !(this.prevPressedMap.get(name) ?? false);
  }

  /** Whether `name` was released this frame. */
  justReleased(name: string): boolean {
    return !(this.pressedMap.get(name) ?? false) && (this.prevPressedMap.get(name) ?? false);
  }

  /**
   * The scalar value of `name`: an `axis` action's `[-1, 1]`, or `1`/`0` for a
   * `button`. `0` for an unknown action.
   */
  value(name: string): number {
    return this.valueMap.get(name) ?? 0;
  }

  /** Alias of {@link ActionState.value}, for reading `axis` actions. */
  axis(name: string): number {
    return this.valueMap.get(name) ?? 0;
  }

  /** The `{ x, y }` of an `axis2d` action; `(0, 0)` for anything else. */
  axis2d(name: string): Axis2dValue {
    return this.vec2Map.get(name) ?? ORIGIN;
  }
}

const ORIGIN: Axis2dValue = Object.freeze({ x: 0, y: 0 });
