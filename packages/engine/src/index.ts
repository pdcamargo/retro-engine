import type {
  CommandEncoder,
  Renderer,
  RenderPassEncoder,
  Surface,
  TextureView,
} from '@retro-engine/renderer-core';
import { World } from '@retro-engine/ecs';

import type { CommandOp } from './commands';
import { applyCommandOp } from './commands';
import { propagateTransforms } from './hierarchy';
import type { Logger } from './log';
import { engineLogger } from './log';
import { runFixedMainLoop } from './fixed-time';
import type { RegisteredSystem } from './schedule';
import { runStage, StageSystems } from './schedule';
import {
  initStateImpl,
  registerOnEnter,
  registerOnExit,
  registerOnTransition,
  registerStateScopedResource,
  runStateTransition,
  StateRegistry,
} from './state';
import type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
import { ResMut, RunCondition } from './system-param';
import { Time } from './time';

export type { Logger } from './log';
export { createConsoleLogger, engineLogger } from './log';
export type { CommandsHandle, EntityCommands } from './commands';
export { Commands } from './commands';
export type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
export { Query, RenderCtx, Res, ResMut, RunCondition } from './system-param';
export { anyWithComponent, inState, resourceChanged, resourceExists } from './run-conditions';
export type { NextStateInstance, StateInstance } from './state';
export { NextState, State } from './state';
export type { FixedClock, RealClock, VirtualClock } from './time';
export { Time } from './time';
export { GlobalTransform, Transform } from './transform';
export type { ChildBuilder } from './hierarchy';
export { Children, Parent } from './hierarchy';

/** A plugin extends an `App` by registering systems, resources, and component types. */
export type Plugin = (app: App) => void;

/**
 * Named stage in the schedule — when a system runs within a frame.
 *
 * **Main schedule (per frame, in order):** `'first'` → `'startup'` (first
 * frame only) → `'preUpdate'` → *internal* `StateTransition` →
 * *internal* `RunFixedMainLoop` → `'update'` → `'postUpdate'` → `'last'` →
 * `'render'`.
 *
 * **FixedMain sub-schedule (zero or more times per frame, driven by the fixed
 * accumulator):** `'fixedFirst'` → `'fixedPreUpdate'` → `'fixedUpdate'` →
 * `'fixedPostUpdate'` → `'fixedLast'`.
 *
 * `'first'` is reserved for engine bookkeeping that must precede everything
 * else — most notably the engine's internal `Time` tick. User systems may
 * register on `'first'` to run "before everything"; they run after the
 * engine's internal systems in registration order.
 *
 * `'last'` is the symmetric stage at the bottom of `Main`, for cleanup that
 * must run after every gameplay system in the frame.
 *
 * State-transition schedules (`OnExit` / `OnTransition` / `OnEnter`) are not
 * stages — register against them through `App.onExit` / `onTransition` /
 * `onEnter`. The fixed-loop driver runs internally; users register against
 * the `'fixed*'` sub-stages above.
 */
export type Stage =
  | 'startup'
  | 'first'
  | 'preUpdate'
  | 'update'
  | 'postUpdate'
  | 'last'
  | 'render'
  | 'fixedFirst'
  | 'fixedPreUpdate'
  | 'fixedUpdate'
  | 'fixedPostUpdate'
  | 'fixedLast';

/**
 * Per-frame context handed to render-stage systems via the `RenderCtx` param.
 * The encoder and pass are scoped to the current frame and become invalid once
 * the frame ends — do not retain them across systems or across ticks.
 */
export interface RenderContext {
  readonly encoder: CommandEncoder;
  readonly pass: RenderPassEncoder;
  readonly surfaceView: TextureView;
}

export interface AppOptions {
  readonly renderer: Renderer;
  /**
   * Canvas to present to. Optional — omitting it produces a headless `App`
   * whose render stage is skipped (useful for tests and server-side worlds).
   */
  readonly canvas?: HTMLCanvasElement;
  /**
   * Color used to clear the swapchain at the start of each render pass.
   * Defaults to opaque black.
   */
  readonly clearColor?: { r: number; g: number; b: number; a: number };
  /**
   * Override the App's diagnostic sink. Defaults to the shared `engineLogger`,
   * which writes to `console.*`. Pass a custom `Logger` to route engine and
   * plugin output to a studio panel, telemetry pipeline, or test buffer.
   */
  readonly logger?: Logger;
}

/** Options that gate or order a registered system. */
export interface AddSystemOptions {
  /** Composable predicate. If present and `test(app)` returns false, the system is skipped on that tick. */
  readonly runIf?: RunCondition;
  /**
   * Free-form label for this system within its stage. Other systems in the
   * same stage can reference the label via `before` / `after`. Labels do
   * **not** cross stages — `before: 'input'` only matches `input`-labelled
   * systems in the same stage.
   *
   * Labels need not be unique; `after: 'physics'` means "after every system
   * in this stage whose label is `'physics'`".
   */
  readonly label?: string;
  /**
   * Run this system before every same-stage system whose `label` matches one
   * of these. Forward references are allowed — the constraint activates as
   * soon as a matching label registers. Labels with no match are silently
   * ignored.
   */
  readonly before?: readonly string[];
  /**
   * Run this system after every same-stage system whose `label` matches one
   * of these. Forward references and unmatched labels behave like `before`.
   */
  readonly after?: readonly string[];
}

/**
 * Holds a `World`, accepts plugins, and runs a stop-able frame loop.
 *
 * Systems register through a single signature — a stage name, a tuple of param
 * tokens declaring what the system reads or writes, the function itself, and
 * optional run conditions / ordering. The function receives one value per
 * param, in order; no implicit world argument.
 *
 * When a canvas is provided, the render stage drives a single main render pass
 * per frame: the engine acquires the swapchain view, begins a pass that clears
 * to {@link AppOptions.clearColor}, invokes each registered render system with
 * the `RenderCtx`-resolved frame context, ends the pass, and submits. A future
 * render-graph layer supersedes this one-pass-per-frame model once multiple
 * passes exist.
 */
export class App {
  readonly world = new World();
  /** Backend renderer the app drives. Plugins use this to build shader modules, pipelines, and other GPU resources. */
  readonly renderer: Renderer;
  /**
   * Diagnostic sink for this App. Plugins and engine subsystems emit through
   * this logger (typically capturing a child view via `logger.child('name')`
   * at plugin-build time). Defaults to the shared `engineLogger`; override
   * via {@link AppOptions.logger}.
   */
  readonly logger: Logger;
  private readonly stages: Readonly<Record<Stage, StageSystems>> = {
    startup: new StageSystems(),
    first: new StageSystems(),
    preUpdate: new StageSystems(),
    update: new StageSystems(),
    postUpdate: new StageSystems(),
    last: new StageSystems(),
    render: new StageSystems(),
    fixedFirst: new StageSystems(),
    fixedPreUpdate: new StageSystems(),
    fixedUpdate: new StageSystems(),
    fixedPostUpdate: new StageSystems(),
    fixedLast: new StageSystems(),
  };
  private readonly resources = new Map<object, object>();
  private readonly resourceChangeFrames = new Map<object, number>();
  private readonly commandsBuffers = new Map<SystemId, CommandOp[]>();
  private readonly stateRegistry = new StateRegistry();
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly clearColor: { r: number; g: number; b: number; a: number };
  private surface: Surface | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private running = false;
  private rafHandle: number | undefined;
  private nextSystemId = 1;
  private currentFrameTimestampMs = 0;
  private hasRunStartup = false;

  constructor(options: AppOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
    this.logger = options.logger ?? engineLogger;
    this.insertResource(new Time());
    this.addSystem('first', [ResMut(Time)], (time) => {
      time.tick(this.currentFrameTimestampMs);
    });
    this.addSystem('postUpdate', [], () => {
      propagateTransforms(this.world, this.logger);
    });
  }

  addPlugin(plugin: Plugin): this {
    plugin(this);
    return this;
  }

  /**
   * Mint a fresh {@link SystemId}. Used internally by state-transition
   * registration helpers (`onEnter`/`onExit`/`onTransition`) so their systems
   * carry an identity from the same numbering domain as stage-registered
   * systems. Not part of the public API.
   *
   * @internal
   */
  mintSystemId(): SystemId {
    return this.nextSystemId++ as SystemId;
  }

  /**
   * Lazily fetch or create the command buffer for a system id. Used by the
   * `Commands` param's resolved handle to enqueue ops; not part of the public
   * API.
   *
   * @internal
   */
  getCommandsBuffer(id: SystemId): CommandOp[] {
    let buf = this.commandsBuffers.get(id);
    if (!buf) {
      buf = [];
      this.commandsBuffers.set(id, buf);
    }
    return buf;
  }

  /**
   * Drain one system's command buffer, applying each enqueued op in order.
   * Deletes the buffer entry before iterating, so an op that re-enqueues into
   * the same system's buffer starts a fresh array (no recursive replay).
   * Called by the stage runners after each system's function returns;
   * no-op when no commands were enqueued.
   *
   * @internal
   */
  flushSystemCommands(id: SystemId): void {
    const buf = this.commandsBuffers.get(id);
    if (!buf || buf.length === 0) return;
    this.commandsBuffers.delete(id);
    for (const op of buf) applyCommandOp(op, this);
  }

  /**
   * Discard one system's command buffer without applying any ops. Called by
   * the stage runners when a system's function throws — applying a partial
   * buffer is more error-prone than dropping it, and stale buffers leaking
   * into the next invocation of the same system id is a latent correctness
   * bug.
   *
   * @internal
   */
  discardSystemCommands(id: SystemId): void {
    this.commandsBuffers.delete(id);
  }

  /**
   * Drain every pending command buffer, in system-id registration order.
   * Intended for orchestration code, tests, and plugin lifecycle hooks that
   * need to materialise queued mutations at a known point outside the
   * per-system flush hooks.
   *
   * Calling this from within a system's function while a `Query` iterator
   * over the same world is live is undefined behavior — structural mutations
   * applied here can invalidate the iterator. Split into two systems with
   * `before` / `after` ordering instead.
   */
  flushCommands(): void {
    if (this.commandsBuffers.size === 0) return;
    const ids = Array.from(this.commandsBuffers.keys());
    for (const id of ids) this.flushSystemCommands(id);
  }

  /**
   * Initialise a state type and seed its initial value. The first frame after
   * this call fires `OnEnter(initial)` during `StateTransition`, between
   * `Startup` and `PreUpdate`'s downstream effects. `initState` may be called
   * once per state type — a second call for the same `ctor` throws.
   *
   * Registers two resources keyed off `State(ctor)` and `NextState(ctor)`:
   * the current-value slot and the pending-transition slot.
   *
   * @example
   * ```ts
   * class GameState {
   *   static readonly Boot    = new GameState('Boot');
   *   static readonly Playing = new GameState('Playing');
   *   constructor(public readonly name: string) {}
   * }
   * app.initState(GameState, GameState.Boot);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initState<S extends object>(ctor: new (...args: any[]) => S, initial: S): this {
    initStateImpl(this, this.stateRegistry, ctor, initial);
    return this;
  }

  /**
   * Register a system to run when the state exits `value`. The system runs
   * during the `StateTransition` phase, **before** state-scoped resources
   * for `value` are removed and before `State.current` updates — so it can
   * still read both.
   */
  onExit<S extends object, const Ps extends readonly Param<unknown>[]>(
    value: S,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: { runIf?: RunCondition },
  ): this {
    registerOnExit(this, this.stateRegistry, value, params, fn, options);
    return this;
  }

  /**
   * Register a system to run when the state transitions specifically from
   * `from` to `to`. Per-pair only — there is no any-to-any helper in v1.
   * Runs after `State.current` has updated and before `OnEnter(to)`.
   */
  onTransition<S extends object, const Ps extends readonly Param<unknown>[]>(
    from: S,
    to: S,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: { runIf?: RunCondition },
  ): this {
    registerOnTransition(this, this.stateRegistry, from, to, params, fn, options);
    return this;
  }

  /**
   * Register a system to run when the state enters `value`. The system runs
   * during the `StateTransition` phase, **after** state-scoped resources for
   * `value` are inserted — so `OnEnter` code can read them.
   */
  onEnter<S extends object, const Ps extends readonly Param<unknown>[]>(
    value: S,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: { runIf?: RunCondition },
  ): this {
    registerOnEnter(this, this.stateRegistry, value, params, fn, options);
    return this;
  }

  /**
   * Register a resource that lives only while the state is `value`. Inserted
   * before `OnEnter(value)` runs and removed after `OnExit(value)` completes
   * — so user `OnExit` code can read the resource one last time.
   *
   * Calling more than once for the same `value` queues additional resources;
   * all are inserted on enter and removed on exit, in registration order.
   */
  insertStateScopedResource<S extends object>(value: S, resource: object): this {
    registerStateScopedResource(this.stateRegistry, value, resource);
    return this;
  }

  /**
   * Register a system at `stage`. The function receives one argument per param
   * in `params`, in order; pass `[]` for a zero-param system. The optional
   * `runIf` condition gates execution per tick; `label` / `before` / `after`
   * declare ordering constraints within the stage.
   *
   * Stage-scoped params (e.g. `RenderCtx`) throw at registration if used in
   * the wrong stage. Introducing an ordering cycle via `before` / `after`
   * also throws at registration, naming the systems involved.
   */
  addSystem<const Ps extends readonly Param<unknown>[]>(
    stage: Stage,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: AddSystemOptions,
  ): this {
    for (const p of params) {
      if (p.scope !== undefined && p.scope !== stage) {
        throw new Error(
          `App.addSystem: param scoped to stage '${p.scope}' cannot be used in stage '${stage}'`,
        );
      }
    }
    const id = this.nextSystemId++ as SystemId;
    const entry: RegisteredSystem = {
      id,
      params,
      fn: fn as (...args: unknown[]) => void,
      ...(options?.runIf !== undefined ? { runIf: options.runIf } : {}),
      ...(options?.label !== undefined ? { label: options.label } : {}),
      ...(options?.before !== undefined ? { before: options.before } : {}),
      ...(options?.after !== undefined ? { after: options.after } : {}),
    };
    this.stages[stage].push(entry);
    // A newly added label may resolve a forward-reference constraint in a
    // sibling stage — labels are stage-local, so no cross-stage invalidation
    // is needed.
    return this;
  }

  /**
   * Register a resource instance, keyed by its constructor. Systems read it
   * through the `Res(ctor)` / `ResMut(ctor)` params. Inserting a second value
   * of the same class replaces the prior instance; a `devWarn` is emitted on
   * replace, silent in production builds.
   */
  insertResource<T extends object>(value: T): this {
    const key = value.constructor;
    if (this.resources.has(key)) {
      this.logger.devWarn(
        `App.insertResource: replacing existing resource of type ${(key as { name?: string }).name || '<anonymous>'}`,
      );
    }
    this.resources.set(key, value);
    this.resourceChangeFrames.set(key, this.currentFrameNumber());
    return this;
  }

  /**
   * Remove a resource by constructor key. Returns the removed instance, or
   * `undefined` if no resource of that class was registered. Idempotent — a
   * second call with the same key returns `undefined` without throwing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeResource<T>(ctor: new (...a: any[]) => T): T | undefined {
    const value = this.resources.get(ctor) as T | undefined;
    if (this.resources.delete(ctor)) {
      this.resourceChangeFrames.set(ctor, this.currentFrameNumber());
    }
    return value;
  }

  /**
   * Frame number on which the resource keyed by `ctor` was most recently
   * inserted, replaced, or removed. Returns `undefined` if no insertion or
   * removal has ever been recorded for this resource key. Used by the
   * `resourceChanged` run-condition helper; in-place mutations are not
   * tracked in v1 — see ADR-0008 §9 and `docs/roadmap/change-detection.md`.
   *
   * @internal
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getResourceChangeFrame<T>(ctor: new (...a: any[]) => T): number | undefined {
    return this.resourceChangeFrames.get(ctor);
  }

  private currentFrameNumber(): number {
    return (this.resources.get(Time) as Time | undefined)?.frame ?? 0;
  }

  /**
   * Look up a resource by constructor. Returns `undefined` if no resource of
   * that class was inserted. Most code should use the `Res(ctor)` (read) or
   * `ResMut(ctor)` (write) params instead; this is the escape hatch the param
   * resolvers themselves rely on.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getResource<T>(ctor: new (...a: any[]) => T): T | undefined {
    return this.resources.get(ctor) as T | undefined;
  }

  /** Start the frame loop. Resolves once startup is complete; the loop runs until {@link App.stop}. */
  async run(): Promise<void> {
    await this.renderer.init();
    if (this.canvas) this.initSurface(this.canvas);
    this.running = true;
    this.advanceFrame(performance.now());
    if (typeof requestAnimationFrame === 'function') {
      const loop = (t: number): void => {
        if (!this.running) return;
        this.advanceFrame(t);
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    }
  }

  /**
   * Drive a single Main-schedule frame:
   * `'first'` → `'startup'` (first frame only) → `'preUpdate'` →
   * *StateTransition* → *RunFixedMainLoop* → `'update'` → `'postUpdate'` →
   * `'last'` → render.
   *
   * The optional `timestampMs` is a `performance.now()`-style
   * `DOMHighResTimeStamp`; the engine's internal time-tick system reads it
   * via the same pathway `requestAnimationFrame` uses in `run`. Omit it to
   * read `performance.now()` at call time.
   *
   * `run` calls this once on startup and again from each `requestAnimationFrame`
   * callback. Tests step the loop synchronously by calling it directly with
   * explicit timestamps, side-stepping `requestAnimationFrame` entirely.
   */
  advanceFrame(timestampMs?: number): void {
    this.currentFrameTimestampMs = timestampMs ?? performance.now();
    runStage(this.stages.first, this, 'first');
    if (!this.hasRunStartup) {
      runStage(this.stages.startup, this, 'startup');
      this.hasRunStartup = true;
    }
    runStage(this.stages.preUpdate, this, 'preUpdate');
    runStateTransition(this, this.stateRegistry);
    runFixedMainLoop(
      this,
      this.stages.fixedFirst,
      this.stages.fixedPreUpdate,
      this.stages.fixedUpdate,
      this.stages.fixedPostUpdate,
      this.stages.fixedLast,
    );
    runStage(this.stages.update, this, 'update');
    runStage(this.stages.postUpdate, this, 'postUpdate');
    runStage(this.stages.last, this, 'last');
    this.renderFrame();
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.surface?.destroy();
    this.surface = undefined;
    this.renderer.destroy();
  }

  /** Returns the configured surface, if any. Render systems read this during pipeline construction. */
  getSurface(): Surface | undefined {
    return this.surface;
  }

  private initSurface(canvas: HTMLCanvasElement): void {
    syncCanvasBackingSize(canvas);
    const surface = this.renderer.createSurface(canvas);
    surface.configure({ format: this.renderer.getPreferredSurfaceFormat() });
    this.surface = surface;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        const { width, height } = syncCanvasBackingSize(canvas);
        surface.resize(width, height);
      });
      this.resizeObserver.observe(canvas);
    }
  }

  private renderFrame(): void {
    if (!this.surface) return;
    const surfaceView = this.surface.getCurrentTextureView();
    const encoder = this.renderer.createCommandEncoder('frame');
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: surfaceView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: this.clearColor,
        },
      ],
    });
    const render: RenderContext = { encoder, pass, surfaceView };
    for (const sys of this.stages.render.ordered()) {
      if (sys.runIf && !sys.runIf.test(this)) continue;
      const ctx: ResolveCtx = {
        app: this,
        world: this.world,
        stage: 'render',
        systemId: sys.id,
        render,
      };
      const values = sys.params.map((p) => p.resolve(ctx));
      try {
        sys.fn(...values);
      } catch (err) {
        this.discardSystemCommands(sys.id);
        throw err;
      }
      this.flushSystemCommands(sys.id);
    }
    pass.end();
    this.renderer.submit([encoder.finish()]);
  }
}

const syncCanvasBackingSize = (canvas: HTMLCanvasElement): { width: number; height: number } => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height };
};
