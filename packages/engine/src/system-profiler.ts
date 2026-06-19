import type { SystemId } from './system-param';

/** Smoothing factor for the rolling average. Higher reacts faster; lower is steadier. */
const EMA_ALPHA = 0.1;

/** Per-system timing sample. */
export interface SystemTiming {
  /** Wall-clock duration of the most recent run, in milliseconds. */
  readonly lastMs: number;
  /** Exponential moving average of recent run durations, in milliseconds. */
  readonly avgMs: number;
}

/**
 * Accumulates per-system run durations when system profiling is enabled (see
 * `AppOptions.profileSystems`). Present as a resource only on profiling Apps;
 * tooling reads it through {@link App.describeSchedule}. Each sample updates a
 * rolling average so a UI reading it once per frame sees stable numbers rather
 * than per-frame noise.
 */
export class SystemProfiler {
  private readonly timings = new Map<SystemId, SystemTiming>();

  /** Record one run of `id` lasting `ms` milliseconds, folding it into the rolling average. */
  record(id: SystemId, ms: number): void {
    const prev = this.timings.get(id);
    const avgMs = prev === undefined ? ms : prev.avgMs + EMA_ALPHA * (ms - prev.avgMs);
    this.timings.set(id, { lastMs: ms, avgMs });
  }

  /** Latest timing for `id`, or `undefined` if it has not run since profiling began. */
  get(id: SystemId): SystemTiming | undefined {
    return this.timings.get(id);
  }
}
