/**
 * The lifecycle phase of a {@link TouchPoint} in the current frame:
 * - `'started'` — began contact this frame.
 * - `'moved'` — moved this frame.
 * - `'stationary'` — in contact but did not move this frame.
 * - `'ended'` — lifted this frame (still readable this frame, dropped next frame).
 * - `'canceled'` — cancelled by the platform this frame.
 */
export type TouchPhase = 'started' | 'moved' | 'stationary' | 'ended' | 'canceled';

/**
 * A single active touch point, identified by the platform's touch id. Positions
 * are in the pointer target's local pixel space (the same space as
 * {@link CursorPosition}); `deltaX`/`deltaY` are the movement accumulated this
 * frame, zeroed at the start of each frame.
 */
export class TouchPoint {
  /** Platform touch identifier, stable for the life of the touch. */
  readonly id: number;
  /** Current position (target-local pixels). */
  x: number;
  y: number;
  /** Position where the touch began. */
  readonly startX: number;
  readonly startY: number;
  /** Movement accumulated this frame. */
  deltaX = 0;
  deltaY = 0;
  /** This frame's lifecycle phase. */
  phase: TouchPhase = 'started';

  constructor(id: number, x: number, y: number) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
  }
}

/**
 * Active touch points, read via `Res(Touches)`. Mirrors the per-frame lifecycle
 * of {@link ButtonInput}: transitions (`justStarted` / `justEnded`) and per-frame
 * deltas are valid only for the current frame. Transient — never serialized.
 *
 * @example
 * ```ts
 * app.addSystem('update', [Res(Touches)], (touches) => {
 *   for (const t of touches.iter()) drag(t.id, t.deltaX, t.deltaY);
 *   const primary = touches.first();
 *   if (primary && touches.justStarted(primary.id)) tapAt(primary.x, primary.y);
 * });
 * ```
 */
export class Touches {
  private readonly points = new Map<number, TouchPoint>();
  private readonly startedThisFrame = new Set<number>();
  private readonly endedThisFrame = new Set<number>();

  /** The touch with id `id`, if present (including one that ended this frame). */
  get(id: number): TouchPoint | undefined {
    return this.points.get(id);
  }

  /** Active (not ended/canceled) touch points, in the order they began. */
  *iter(): IterableIterator<TouchPoint> {
    for (const t of this.points.values()) {
      if (t.phase !== 'ended' && t.phase !== 'canceled') yield t;
    }
  }

  /** Number of active touch points. */
  count(): number {
    let n = 0;
    for (const t of this.points.values()) if (t.phase !== 'ended' && t.phase !== 'canceled') n += 1;
    return n;
  }

  /** The primary (earliest-started, still-active) touch, or `undefined`. */
  first(): TouchPoint | undefined {
    for (const t of this.points.values()) {
      if (t.phase !== 'ended' && t.phase !== 'canceled') return t;
    }
    return undefined;
  }

  /** Whether `id` began contact this frame. */
  justStarted(id: number): boolean {
    return this.startedThisFrame.has(id);
  }

  /** Whether `id` lifted or was cancelled this frame. */
  justEnded(id: number): boolean {
    return this.endedThisFrame.has(id);
  }

  /** Whether any touch began this frame. */
  anyJustStarted(): boolean {
    return this.startedThisFrame.size > 0;
  }

  /**
   * @internal Advance to a new frame: drop touches that ended last frame, clear
   * transition sets, zero deltas, and demote `started`/`moved` to `stationary`.
   * Called once per frame before this frame's events are applied.
   */
  beginFrame(): void {
    for (const [id, t] of this.points) {
      if (t.phase === 'ended' || t.phase === 'canceled') this.points.delete(id);
    }
    this.startedThisFrame.clear();
    this.endedThisFrame.clear();
    for (const t of this.points.values()) {
      t.deltaX = 0;
      t.deltaY = 0;
      if (t.phase === 'started' || t.phase === 'moved') t.phase = 'stationary';
    }
  }

  /** @internal Apply a touch-start event. */
  start(id: number, x: number, y: number): void {
    const point = new TouchPoint(id, x, y);
    this.points.set(id, point);
    this.startedThisFrame.add(id);
  }

  /** @internal Apply a touch-move event; synthesizes a start if unseen. */
  move(id: number, x: number, y: number): void {
    const point = this.points.get(id);
    if (point === undefined) {
      this.start(id, x, y);
      return;
    }
    point.deltaX += x - point.x;
    point.deltaY += y - point.y;
    point.x = x;
    point.y = y;
    if (point.phase !== 'started') point.phase = 'moved';
  }

  /** @internal Apply a touch-end event. */
  end(id: number): void {
    const point = this.points.get(id);
    if (point === undefined) return;
    point.phase = 'ended';
    this.endedThisFrame.add(id);
  }

  /** @internal Apply a touch-cancel event. */
  cancel(id: number): void {
    const point = this.points.get(id);
    if (point === undefined) return;
    point.phase = 'canceled';
    this.endedThisFrame.add(id);
  }
}
