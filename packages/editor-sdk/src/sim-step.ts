import { type App, RunCondition } from '@retro-engine/engine';

import { currentSimState, SimState } from './sim-state';

/**
 * Transient control flag for play-mode "Step": advance the simulation exactly
 * one frame while {@link SimState.Paused}, without leaving the paused state.
 *
 * `requested` queues a step; `active` is true only during the single frame the
 * stepped gameplay systems run. Editor-only control state with no persistent
 * identity, so it is deliberately not serialized.
 */
export class SimStep {
  /** A step has been requested; the next frame runs gameplay once. */
  requested = false;
  /** True only during the one frame the stepped gameplay systems run. */
  active = false;
}

/**
 * Register {@link SimStep} and the per-frame system that opens its one-frame
 * `active` window. The system runs in `'first'` — before any gameplay system
 * evaluates its run condition — so a queued step is visible for exactly the
 * frame it fires, then consumed. Call once during setup, after
 * {@link initSimState}.
 */
export const installSimStep = (app: App): void => {
  const step = new SimStep();
  app.insertResource(step);
  app.addSystem(
    'first',
    [],
    () => {
      // Reset every frame; a pending request opens the window for this frame
      // only, then clears itself so the next frame freezes again.
      step.active = false;
      if (step.requested) {
        step.active = true;
        step.requested = false;
      }
    },
    { name: 'editor-sim-step' },
  );
};

/**
 * Queue a one-frame step, applied on the next frame. No-op unless
 * {@link SimState.Paused}: stepping is meaningless while editing (no play
 * world) or already playing (every frame already advances).
 */
export const requestSimStep = (app: App): void => {
  if (currentSimState(app) !== SimState.Paused) return;
  const step = app.getResource(SimStep);
  if (step !== undefined) step.requested = true;
};

/**
 * Run condition that passes only during a stepped frame's gameplay window.
 * Compose it with the play gate — `inState(SimState.Play).or(simStepActive())`
 * — so gameplay systems run while playing *or* for a single stepped frame,
 * without the paused state ever changing.
 */
export const simStepActive = (): RunCondition =>
  new RunCondition((app) => app.getResource(SimStep)?.active === true);
