/** Min / max / mean / 99th-percentile of a set of frame times, in milliseconds. */
export interface FrameTimeStats {
  /** Fastest frame in the window (ms). */
  readonly min: number;
  /** Slowest frame in the window (ms). */
  readonly max: number;
  /** Mean frame time over the window (ms). */
  readonly avg: number;
  /**
   * 99th-percentile frame time (ms) — the threshold the slowest ~1% of frames
   * exceed. `1000 / p99` is the conventional "1% low FPS" stutter metric.
   */
  readonly p99: number;
}

/**
 * Compute min / max / mean / 99th-percentile of `samples` (frame times in ms).
 * The 99th percentile uses nearest-rank (`ceil(0.99 · n)`), clamped for a small
 * window. An empty window yields all zeros. Pure; does not mutate `samples`.
 */
export const frameTimeStats = (samples: readonly number[]): FrameTimeStats => {
  const n = samples.length;
  if (n === 0) return { min: 0, max: 0, avg: 0, p99: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  let sum = 0;
  for (const s of sorted) sum += s;
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(n * 0.99) - 1));
  return { min: sorted[0]!, max: sorted[n - 1]!, avg: sum / n, p99: sorted[rank]! };
};

/**
 * A fixed-capacity rolling window of recent frame times (ms), backed by a ring
 * buffer so the per-frame push is O(1). Query {@link FrameTimeWindow.stats} for
 * the current min / max / avg / p99 across the window — the data behind an FPS
 * overlay's "1% low" readout.
 */
export class FrameTimeWindow {
  private readonly samples: number[] = [];
  private head = 0;

  /**
   * @param capacity Frames retained. Default `120` (~2s at 60fps) — long enough
   * to surface a stutter, short enough to stay current.
   */
  constructor(readonly capacity: number = 120) {}

  /** Record one frame time (ms), evicting the oldest once at capacity. */
  push(ms: number): void {
    if (this.samples.length < this.capacity) {
      this.samples.push(ms);
    } else {
      this.samples[this.head] = ms;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** The retained samples (unordered; oldest-eviction makes order arbitrary). */
  values(): readonly number[] {
    return this.samples;
  }

  /** How many samples are currently retained (≤ `capacity`). */
  get size(): number {
    return this.samples.length;
  }

  /** Min / max / avg / p99 across the current window. */
  stats(): FrameTimeStats {
    return frameTimeStats(this.samples);
  }

  /** Drop every retained sample. */
  clear(): void {
    this.samples.length = 0;
    this.head = 0;
  }
}
