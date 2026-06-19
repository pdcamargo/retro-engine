import type { RenderSetName } from './render-set';
import type { SystemOrigin } from './schedule';
import type { Stage } from './index';
import type { SystemId } from './system-param';

/**
 * A read-only snapshot of one registered system, produced by
 * {@link App.describeSchedule} for tooling (the studio's Systems panel). Holds
 * no live references — safe to retain or diff across frames.
 */
export interface SystemInfo {
  /** Stable per-App system identity. */
  readonly id: SystemId;
  /** Human-readable display name. */
  readonly name: string;
  /** Stage this system runs in. */
  readonly stage: Stage;
  /** Render sub-set, present only for `'render'`-stage systems. */
  readonly set?: RenderSetName;
  /** Ordering label, if one was given. */
  readonly label?: string;
  /** Origin bucket — `'engine'`, `'editor'`, or `'user'`. */
  readonly origin: SystemOrigin;
  /** Name of the registering plugin, or `null` when registered directly on the App. */
  readonly originPlugin: string | null;
  /** Whether the system currently runs (false when disabled via {@link App.setSystemEnabled}). */
  readonly enabled: boolean;
  /** Whether the system has a run condition gating it. */
  readonly hasRunCondition: boolean;
  /** Most recent run duration in milliseconds; present only when profiling is enabled and the system has run. */
  readonly lastMs?: number;
  /** Rolling-average run duration in milliseconds; present only when profiling is enabled and the system has run. */
  readonly avgMs?: number;
}

/** Systems registered against one stage, in execution (topologically-sorted) order. */
export interface StageGroup {
  readonly stage: Stage;
  readonly systems: readonly SystemInfo[];
}
