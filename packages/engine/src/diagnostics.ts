import type { App } from './index';
import type { PluginObject } from './plugin';
import { Res, ResMut } from './system-param';
import { Time } from './time';

/**
 * Rolling engine diagnostics, updated once per frame by {@link DiagnosticsPlugin}
 * and read through `Res(DiagnosticsStore)` — the data source for an FPS / frame-time
 * overlay or a headless perf probe. Runtime-only (recomputed every frame), so it
 * is not serialized.
 */
export class DiagnosticsStore {
  /** Smoothed frame time in milliseconds (EMA of the real per-frame delta). */
  frameTimeMs = 0;
  /** Frames per second derived from {@link frameTimeMs}; `0` until the first timed frame. */
  fps = 0;
  /** Live entity count at the last update. */
  entityCount = 0;
  /** Total frames advanced since the store was inserted. */
  frameCount = 0;
}

/** EMA weight for the new sample. Smooths jitter while staying responsive. */
const SMOOTHING = 0.1;

/**
 * Fold one frame into `store`: bump the frame count, snapshot the entity count,
 * and — for a real (non-zero) delta — update the smoothed frame time and derived
 * FPS. Uses the **real** clock delta so diagnostics reflect wall-clock cost, not
 * paused/scaled gameplay time. Pure; the plugin calls it each frame.
 */
export const updateDiagnostics = (
  store: DiagnosticsStore,
  realDeltaSeconds: number,
  entityCount: number,
): void => {
  store.frameCount += 1;
  store.entityCount = entityCount;
  const dtMs = realDeltaSeconds * 1000;
  if (dtMs <= 0) return;
  store.frameTimeMs = store.frameTimeMs === 0 ? dtMs : store.frameTimeMs + (dtMs - store.frameTimeMs) * SMOOTHING;
  store.fps = store.frameTimeMs > 0 ? 1000 / store.frameTimeMs : 0;
};

/**
 * Opt-in plugin that inserts a {@link DiagnosticsStore} and updates it every frame
 * (a `'last'`-stage system, after gameplay has settled the entity count). Add it
 * when a game or the studio wants live FPS / frame-time / entity-count readouts;
 * it is inert otherwise (no store, no cost).
 */
export class DiagnosticsPlugin implements PluginObject {
  name(): string {
    return 'DiagnosticsPlugin';
  }

  build(app: App): void {
    if (app.getResource(DiagnosticsStore) === undefined) app.insertResource(new DiagnosticsStore());
    app.addSystem(
      'last',
      [Res(Time), ResMut(DiagnosticsStore)],
      (time, store) => {
        updateDiagnostics(store as DiagnosticsStore, (time as Time).real.delta, app.world.entityCount);
      },
      { label: 'diagnostics-update' },
    );
  }
}
