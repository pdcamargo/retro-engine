import type { App } from './index';
import type { StageSystems } from './schedule';
import { runStage } from './schedule';
import { Time } from './time';

/**
 * Hard cap on FixedMain substeps per frame. If the virtual delta exceeds
 * `MAX_SUBSTEPS_PER_FRAME * timestep`, the residual accumulator is dropped
 * and a single warning is emitted. Prevents the "spiral of death" where
 * each frame falls further behind than the last.
 *
 * 8 matches Bevy's default ceiling: enough headroom for normal frame hitches,
 * tight enough that a stalled tab can't burn unbounded CPU once it resumes.
 */
const MAX_SUBSTEPS_PER_FRAME = 8;

/**
 * Run the FixedMain sub-schedule (`fixedFirst → fixedPreUpdate → fixedUpdate →
 * fixedPostUpdate → fixedLast`) zero or more times for the current frame,
 * driven by the accumulator on `Time.fixed`.
 *
 * On entry: `time.fixed.overstep += time.virtual.delta` (the virtual clock's
 * already-scaled, pause-aware delta — so a paused or zero-scaled virtual
 * clock pauses the fixed loop too). While `overstep >= timestep` **and**
 * the substep count is under {@link MAX_SUBSTEPS_PER_FRAME}, set
 * `time.fixed.delta = timestep`, run the five fixed stages in order,
 * advance `elapsed` by `timestep`, and decrement the accumulator. On exit,
 * `time.fixed.delta = 0`.
 *
 * If the cap is hit while the accumulator is still ≥ `timestep`, drop the
 * residual (`overstep = 0`) and `app.logger.warn` once for the frame.
 *
 * No-op when none of the five fixed stages have systems registered — the
 * accumulator is still updated, but the inner loop short-circuits.
 *
 * Called from `App.advanceFrame` between the StateTransition phase and
 * `update`; not part of the public API.
 */
export const runFixedMainLoop = (
  app: App,
  fixedFirst: StageSystems,
  fixedPreUpdate: StageSystems,
  fixedUpdate: StageSystems,
  fixedPostUpdate: StageSystems,
  fixedLast: StageSystems,
): void => {
  const time = app.getResource(Time);
  if (time === undefined) return;
  time.fixed.overstep += time.virtual.delta;
  const timestep = time.fixed.timestep;
  if (timestep <= 0) {
    // Defensive: a non-positive timestep would loop forever. Treat as paused.
    time.fixed.delta = 0;
    return;
  }
  let substeps = 0;
  while (time.fixed.overstep >= timestep && substeps < MAX_SUBSTEPS_PER_FRAME) {
    time.fixed.delta = timestep;
    runStage(fixedFirst, app, 'fixedFirst');
    runStage(fixedPreUpdate, app, 'fixedPreUpdate');
    runStage(fixedUpdate, app, 'fixedUpdate');
    runStage(fixedPostUpdate, app, 'fixedPostUpdate');
    runStage(fixedLast, app, 'fixedLast');
    time.fixed.elapsed += timestep;
    time.fixed.overstep -= timestep;
    substeps += 1;
  }
  time.fixed.delta = 0;
  if (substeps === MAX_SUBSTEPS_PER_FRAME && time.fixed.overstep >= timestep) {
    app.logger.warn(
      `FixedMain: clamped substeps to ${MAX_SUBSTEPS_PER_FRAME} this frame — dropping residual accumulator (${time.fixed.overstep.toFixed(4)}s)`,
    );
    time.fixed.overstep = 0;
  }
};
