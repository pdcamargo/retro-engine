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
import { ComponentHookRegistry } from './component-hooks';
import type { HookCtx, HookKind } from './component-hooks';
import { CorePlugin } from './core-plugin';
import type { Logger } from './log';
import { engineLogger } from './log';
import { runFixedMainLoop } from './fixed-time';
import { MessageRegistry } from './messages';
import { ObserverRegistry } from './observers';
import type { Plugin, PluginObject, PluginsState } from './plugin';
import { wrapFunctionPlugin } from './plugin';
import type { PluginGroup } from './plugin-group';
import { PluginGroupBuilder } from './plugin-group';
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
import { RunCondition } from './system-param';
import { Time } from './time';

export type { Logger } from './log';
export { createConsoleLogger, engineLogger } from './log';
export type { CommandsHandle, EntityCommands } from './commands';
export { Commands } from './commands';
export type { HookCtx, HookKind, LifecycleEvent } from './component-hooks';
export { Lifecycle } from './component-hooks';
export type { MessageEntry, MessageWriterHandle } from './messages';
export { MessageReader, MessageWriter } from './messages';
export type { TriggerHandle } from './observers';
export { Trigger } from './observers';
export type { Plugin, PluginFn, PluginObject, PluginsState } from './plugin';
export type { PluginGroup } from './plugin-group';
export { PluginGroupBuilder } from './plugin-group';
export type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
export { Query, RenderCtx, Res, ResMut, RunCondition } from './system-param';
export { RemovedComponents } from './change-detection';
export { anyWithComponent, inState, resourceChanged, resourceExists } from './run-conditions';
export type { NextStateInstance, StateInstance } from './state';
export { NextState, State } from './state';
export type { FixedClock, RealClock, VirtualClock } from './time';
export { Time } from './time';
export { GlobalTransform, Transform } from './transform';
export type { ChildBuilder } from './hierarchy';
export { Children, Parent } from './hierarchy';

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
  private readonly lastSeenTickMap = new Map<SystemId, number>();
  private readonly stateRegistry = new StateRegistry();
  /** @internal Frame-buffered message channels. Drained at the end of `advanceFrame`. */
  readonly messageRegistry: MessageRegistry = new MessageRegistry();
  /** @internal Observer registry — global + entity-targeted, keyed by event class. */
  readonly observerRegistry: ObserverRegistry = new ObserverRegistry();
  /** @internal Component-lifecycle hook registry (plugin-side; class-static hooks are reflection-discovered). */
  readonly componentHookRegistry: ComponentHookRegistry = new ComponentHookRegistry();
  /**
   * @internal Re-entrant trigger depth tracker. Set by the observer dispatch
   * to the current op's depth; read by `CommandsHandle.trigger` to stamp
   * newly-enqueued trigger ops. Reset between command flushes.
   */
  currentTriggerDepth = 0;
  /**
   * @internal Stage of the system currently being flushed. Threaded into
   * observer dispatch's ResolveCtx so observer-body params resolving inside
   * the flush see the same stage as the triggering system.
   */
  currentFlushStage: Stage = 'update';
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly clearColor: { r: number; g: number; b: number; a: number };
  private surface: Surface | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private running = false;
  private rafHandle: number | undefined;
  private nextSystemId = 1;
  private currentFrameTimestampMs = 0;
  private hasRunStartup = false;

  private readonly pluginRegistry: PluginObject[] = [];
  private readonly pluginNameIndex = new Map<string, PluginObject>();
  private readonly pluginsReadyFlags: boolean[] = [];
  private _pluginsState: PluginsState = 'Building';

  constructor(options: AppOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
    this.logger = options.logger ?? engineLogger;
    this.addPlugin(new CorePlugin());
  }

  /**
   * Current phase of the plugin lifecycle state machine. Starts at
   * `'Building'`; the first {@link App.advanceFrame} (or {@link App.run})
   * transitions through `'Ready'` and `'Cleaned'` once every plugin's
   * `ready()` reports true.
   */
  get pluginsState(): PluginsState {
    return this._pluginsState;
  }

  /**
   * Register a plugin. Accepts either an object implementing the
   * {@link PluginObject} interface or a {@link PluginFn} callback — function
   * plugins are auto-wrapped (named functions are unique by `fn.name`;
   * anonymous functions are non-unique).
   *
   * Throws if the App is no longer in `'Building'` (i.e. the first
   * `advanceFrame` has already run), or if the plugin's
   * {@link PluginObject.isUnique} reports true and another plugin with the
   * same `name()` is already registered. Calls `plugin.build(this)`
   * synchronously before returning.
   */
  addPlugin(plugin: Plugin): this {
    if (this._pluginsState !== 'Building') {
      throw new Error(
        `App.addPlugin: plugins must be registered before the first advanceFrame — App is in state '${this._pluginsState}'`,
      );
    }
    const wrapped = wrapFunctionPlugin(plugin);
    const name = wrapped.name();
    const unique = wrapped.isUnique?.() ?? true;
    if (unique && this.pluginNameIndex.has(name)) {
      throw new Error(
        `App.addPlugin: plugin '${name}' is unique and already registered — set isUnique() to false to allow duplicates`,
      );
    }
    this.pluginRegistry.push(wrapped);
    this.pluginsReadyFlags.push(false);
    this.pluginNameIndex.set(name, wrapped);
    wrapped.build(this);
    return this;
  }

  /**
   * Register a batch of plugins in order. Accepts a `Plugin[]`, a
   * {@link PluginGroup} (its `.build()` builder is materialised), or a
   * {@link PluginGroupBuilder} (its current entry list is flushed). Each
   * resolved plugin is forwarded to {@link App.addPlugin} in order — the
   * same uniqueness and state-machine checks apply.
   */
  addPlugins(input: ReadonlyArray<PluginObject> | PluginGroup | PluginGroupBuilder): this {
    let plugins: ReadonlyArray<PluginObject>;
    if (Array.isArray(input)) {
      plugins = input;
    } else if (input instanceof PluginGroupBuilder) {
      plugins = input.build();
    } else {
      plugins = (input as PluginGroup).build().build();
    }
    for (const p of plugins) this.addPlugin(p);
    return this;
  }

  /**
   * Drive the plugin lifecycle one tick: while `_pluginsState === 'Building'`,
   * poll `ready()` for each not-yet-ready plugin; when every plugin reports
   * true, run `finish()` and `cleanup()` in registration order and advance
   * state to `'Cleaned'`. No-op once cleaned.
   *
   * Called at the very top of {@link App.advanceFrame}, before any system
   * runs. The schedule still runs every frame regardless of state — only
   * the lifecycle hooks are gated.
   */
  private tickPluginLifecycle(): void {
    if (this._pluginsState !== 'Building') return;
    let allReady = true;
    for (let i = 0; i < this.pluginRegistry.length; i += 1) {
      if (this.pluginsReadyFlags[i]) continue;
      const plugin = this.pluginRegistry[i]!;
      const ready = plugin.ready ? plugin.ready(this) : true;
      if (ready) {
        this.pluginsReadyFlags[i] = true;
      } else {
        allReady = false;
      }
    }
    if (!allReady) return;
    for (const plugin of this.pluginRegistry) {
      plugin.finish?.(this);
    }
    this._pluginsState = 'Ready';
    for (const plugin of this.pluginRegistry) {
      plugin.cleanup?.(this);
    }
    this._pluginsState = 'Cleaned';
  }

  /**
   * Latest `performance.now()`-style timestamp recorded by
   * {@link App.advanceFrame}. The engine's internal `Time.tick` system
   * (registered by `CorePlugin`) reads this to advance the clock. Exposed
   * for engine-internal plugins; gameplay code reads time through
   * `Res(Time)` / `ResMut(Time)`.
   *
   * @internal
   */
  currentFrameTimestamp(): number {
    return this.currentFrameTimestampMs;
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
   * Newly-enqueued ops produced during dispatch (typically from observer
   * bodies or component hooks invoked inside `applyCommandOp`) are appended
   * to the same buffer and fire in the same flush, subject to the
   * re-entrant trigger depth limit. The buffer entry is removed from the
   * map at the end of the flush (in `finally`, so a throw mid-flush still
   * cleans up); a subsequent invocation of the same system therefore starts
   * with an empty buffer.
   *
   * Tracks `currentFlushStage` so observer dispatch inside the flush can
   * thread the triggering system's stage into the observer's ResolveCtx.
   *
   * Called by the stage runners after each system's function returns;
   * no-op when no commands were enqueued.
   *
   * @internal
   */
  flushSystemCommands(id: SystemId, stage: Stage = 'update'): void {
    const buf = this.commandsBuffers.get(id);
    if (!buf || buf.length === 0) return;
    const prevStage = this.currentFlushStage;
    this.currentFlushStage = stage;
    try {
      let i = 0;
      while (i < buf.length) {
        const op = buf[i]!;
        i += 1;
        applyCommandOp(op, this, id);
      }
    } finally {
      this.commandsBuffers.delete(id);
      this.currentFlushStage = prevStage;
      this.currentTriggerDepth = 0;
    }
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
   * Read the pre-run tick snapshot previously recorded for system `id`, or
   * `0` if the system has not run yet. Called by the scheduler immediately
   * before invoking a system to populate `ResolveCtx.lastSeenTick`.
   *
   * @internal
   */
  lastSeenTickOf(id: SystemId): number {
    return this.lastSeenTickMap.get(id) ?? 0;
  }

  /**
   * Store the pre-run tick snapshot for system `id`. Called by the scheduler
   * after a system's body returns and its command buffer flushes. The stored
   * value is `World.changeTick` as observed *before* the system ran — so the
   * system re-observes its own prior-frame mutations on its next invocation
   * (the Bevy-aligned pre-run snapshot model).
   *
   * @internal
   */
  recordSystemLastSeenTick(id: SystemId, tick: number): void {
    this.lastSeenTickMap.set(id, tick);
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

  /**
   * Register a frame-buffered message class. Idempotent — re-registering the
   * same constructor is a silent no-op and does not reset the buffer. After
   * registration, systems with `MessageWriter(ctor)` may write payloads;
   * unregistered writes throw at flush time.
   *
   * Readers (`MessageReader(ctor)`) are silent on missing registration —
   * they yield nothing — so a reader can be wired against a future message
   * type before the source plugin registers it.
   *
   * Buffers drain at the end of `advanceFrame` (after all stages and the
   * removed-buffer drain). A `runIf`-gated reader that skips a frame loses
   * that frame's messages; same hazard pattern as `RemovedComponents`.
   *
   * @example
   * ```ts
   * class Death { constructor(public entity: Entity) {} }
   * app.addMessage(Death);
   * ```
   */
  addMessage<T extends object>(ctor: new (...args: never[]) => T): this {
    this.messageRegistry.register(ctor as unknown as new (...args: never[]) => object);
    return this;
  }

  /**
   * Read the message registry. Internal accessor used by `MessageWriter` /
   * `MessageReader` param resolvers; not part of the public API.
   *
   * @internal
   */
  getMessageRegistry(): MessageRegistry {
    return this.messageRegistry;
  }

  /**
   * Register a global observer against event class `eventCtor`. The observer
   * fires synchronously whenever `commands.trigger(event)` posts an event of
   * that class — globally — or whenever an entity-targeted trigger
   * (`commands.entity(e).trigger(event)`) fires (entity-targeted observers
   * fire first, then globals, in registration order).
   *
   * The observer is a system in disguise: its params resolve the same way
   * `addSystem`'s do (against the triggering system's `ResolveCtx`). The
   * conventional first param is `Trigger(eventCtor)` to access the event
   * payload and the optional target entity.
   *
   * @example
   * ```ts
   * class PlayerDied { constructor(public entity: Entity) {} }
   * app.addObserver([Trigger(PlayerDied), Commands], (trig, cmd) => {
   *   cmd.spawn(new Tombstone(trig.event().entity));
   * });
   * ```
   */
  addObserver<E extends object, const Ps extends readonly Param<unknown>[]>(
    eventCtor: new (...args: never[]) => E,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
  ): this {
    this.observerRegistry.registerGlobal(
      eventCtor as unknown as new (...args: never[]) => object,
      params,
      fn as (...args: unknown[]) => void,
    );
    return this;
  }

  /**
   * Register a plugin-side component hook of `kind` for component class
   * `ctor`. Hooks fire during the commands flush when a structural mutation
   * touches the type:
   *
   * - `onAdd` — first time `ctor` appears on an entity (newly attached).
   * - `onInsert` — every insert pass that touches `ctor`, including
   *   replace-in-place. Superset of `onAdd`.
   * - `onReplace` — only when `ctor` was already present and is being
   *   overwritten. Fires pre-mutation with the OLD value.
   * - `onRemove` — once per removal (including the per-component fan-out
   *   at despawn). Fires pre-mutation with the about-to-be-removed value.
   *
   * The component class may also declare static methods of the same names
   * (`class Sprite { static onAdd(ctx) { … } }`) — those fire first, then
   * registry entries in registration order.
   *
   * Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` /
   * `world.despawn` calls (outside a commands flush) do NOT fire hooks in
   * v1; the dispatch lives at the engine/commands layer. Test code that
   * needs hook coverage routes through `Commands`.
   */
  registerComponentHook<T extends object>(
    ctor: new (...args: never[]) => T,
    kind: HookKind,
    fn: (ctx: HookCtx<T>) => void,
  ): this {
    this.componentHookRegistry.register(
      ctor as unknown as new (...args: never[]) => object,
      kind,
      fn as (ctx: HookCtx<unknown>) => void,
    );
    return this;
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
    this.tickPluginLifecycle();
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
    this.world.drainRemovedBuffer();
    this.messageRegistry.drainAll();
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
      const lastSeenTick = this.lastSeenTickOf(sys.id);
      const tickAtRunStart = this.world.changeTick;
      const ctx: ResolveCtx = {
        app: this,
        world: this.world,
        stage: 'render',
        systemId: sys.id,
        lastSeenTick,
        render,
      };
      const values = sys.params.map((p) => p.resolve(ctx));
      try {
        sys.fn(...values);
      } catch (err) {
        this.discardSystemCommands(sys.id);
        throw err;
      }
      this.flushSystemCommands(sys.id, 'render');
      this.recordSystemLastSeenTick(sys.id, tickAtRunStart);
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
