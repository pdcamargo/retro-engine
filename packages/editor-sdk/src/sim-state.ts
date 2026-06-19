import { type App, NextState, type NextStateInstance, State, type StateInstance } from '@retro-engine/engine';

/**
 * The editor's play-mode state: whether the studio is authoring the scene
 * (`Edit`), running the simulation (`Play`), or holding it frozen (`Paused`).
 *
 * Backed by the engine's state machinery — register it with
 * {@link initSimState}, gate systems on it with `inState(SimState.Play)`, and
 * read the live value with {@link currentSimState}. "Edit" is an editor
 * concept, so this type lives in the editor SDK rather than the runtime engine.
 */
export class SimState {
  /** Authoring: the simulation is stopped; the scene is being edited. */
  static readonly Edit = new SimState('Edit');
  /** Running: the simulation advances every frame. */
  static readonly Play = new SimState('Play');
  /** Frozen: the simulation is held at the current frame, ready to resume. */
  static readonly Paused = new SimState('Paused');

  constructor(
    /** Stable identifier for this state value. */
    readonly name: string,
  ) {}
}

/**
 * Register {@link SimState} on the App with `Edit` as the initial value. Call
 * once during setup, before the first frame.
 */
export const initSimState = (app: App): void => {
  app.initState(SimState, SimState.Edit);
};

/**
 * The current play-mode state, or `undefined` before the first frame's state
 * transition has applied the initial value.
 */
export const currentSimState = (app: App): SimState | undefined =>
  (app.getResource(State(SimState)) as StateInstance<SimState> | undefined)?.current;

/**
 * Queue a transition to `value`, applied on the next frame's state-transition
 * phase. Re-requesting the current value still fires a full transition cycle.
 */
export const requestSimState = (app: App, value: SimState): void => {
  (app.getResource(NextState(SimState)) as NextStateInstance<SimState> | undefined)?.set(value);
};
