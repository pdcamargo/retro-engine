import type {
  CommandEncoder,
  Renderer,
  RenderPassEncoder,
  Surface,
  TextureView,
} from '@retro-engine/renderer-core';
import { World } from '@retro-engine/ecs';

import type { Logger } from './log';
import { engineLogger } from './log';
import type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
import { ResMut, RunCondition } from './system-param';
import { Time } from './time';

export type { Logger } from './log';
export { createConsoleLogger, engineLogger } from './log';
export type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
export { Query, RenderCtx, Res, ResMut, RunCondition } from './system-param';
export type { RealClock, VirtualClock } from './time';
export { Time } from './time';

/** A plugin extends an `App` by registering systems, resources, and component types. */
export type Plugin = (app: App) => void;

/**
 * Named stage in the schedule — when a system runs within a frame. Within a
 * frame, stages run in this order: `'first'` → `'preUpdate'` → `'update'` →
 * `'postUpdate'` → `'render'`. `'startup'` runs once during `App.run`, before
 * the first frame.
 *
 * `'first'` is reserved for engine bookkeeping that must precede everything
 * else — most notably the engine's internal `Time` tick. User systems may
 * register on `'first'` to run "before everything"; they run after the
 * engine's internal systems in registration order.
 */
export type Stage = 'startup' | 'first' | 'preUpdate' | 'update' | 'postUpdate' | 'render';

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
}

interface RegisteredSystem {
  readonly id: SystemId;
  readonly params: ReadonlyArray<Param<unknown>>;
  readonly fn: (...args: unknown[]) => void;
  readonly runIf?: RunCondition;
}

/**
 * Holds a `World`, accepts plugins, and runs a stop-able frame loop.
 *
 * Systems register through a single signature — a stage name, a tuple of param
 * tokens declaring what the system reads or writes, the function itself, and
 * optional run conditions. The function receives one value per param, in
 * order; no implicit world argument.
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
  private readonly systems: {
    startup: RegisteredSystem[];
    first: RegisteredSystem[];
    preUpdate: RegisteredSystem[];
    update: RegisteredSystem[];
    postUpdate: RegisteredSystem[];
    render: RegisteredSystem[];
  } = {
    startup: [],
    first: [],
    preUpdate: [],
    update: [],
    postUpdate: [],
    render: [],
  };
  private readonly resources = new Map<object, object>();
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly clearColor: { r: number; g: number; b: number; a: number };
  private surface: Surface | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private running = false;
  private rafHandle: number | undefined;
  private nextSystemId = 1;
  private currentFrameTimestampMs = 0;

  constructor(options: AppOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
    this.logger = options.logger ?? engineLogger;
    this.insertResource(new Time());
    this.addSystem('first', [ResMut(Time)], (time) => {
      time.tick(this.currentFrameTimestampMs);
    });
  }

  addPlugin(plugin: Plugin): this {
    plugin(this);
    return this;
  }

  /**
   * Register a system at `stage`. The function receives one argument per param
   * in `params`, in order; pass `[]` for a zero-param system. The optional
   * `runIf` condition gates execution per tick.
   *
   * Stage-scoped params (e.g. `RenderCtx`) throw at registration if used in
   * the wrong stage.
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
    };
    this.systems[stage].push(entry);
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
    this.resources.delete(ctor);
    return value;
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
    this.runStage('startup');
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
   * Drive a single frame: `'first'` → `'preUpdate'` → `'update'` →
   * `'postUpdate'` → render. The optional `timestampMs` is a
   * `performance.now()`-style `DOMHighResTimeStamp`; the engine's internal
   * time-tick system reads it via the same pathway `requestAnimationFrame`
   * uses in `run`. Omit it to read `performance.now()` at call time.
   *
   * `run` calls this once on startup and again from each `requestAnimationFrame`
   * callback. Tests step the loop synchronously by calling it directly with
   * explicit timestamps, side-stepping `requestAnimationFrame` entirely.
   */
  advanceFrame(timestampMs?: number): void {
    this.currentFrameTimestampMs = timestampMs ?? performance.now();
    this.runStage('first');
    this.runStage('preUpdate');
    this.runStage('update');
    this.runStage('postUpdate');
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

  private runStage(stage: Exclude<Stage, 'render'>): void {
    const list = this.systems[stage];
    if (list.length === 0) return;
    for (const sys of list) {
      if (sys.runIf && !sys.runIf.test(this)) continue;
      const ctx: ResolveCtx = {
        app: this,
        world: this.world,
        stage,
        systemId: sys.id,
      };
      this.invokeSystem(sys, ctx);
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
    for (const sys of this.systems.render) {
      if (sys.runIf && !sys.runIf.test(this)) continue;
      const ctx: ResolveCtx = {
        app: this,
        world: this.world,
        stage: 'render',
        systemId: sys.id,
        render,
      };
      this.invokeSystem(sys, ctx);
    }
    pass.end();
    this.renderer.submit([encoder.finish()]);
  }

  private invokeSystem(sys: RegisteredSystem, ctx: ResolveCtx): void {
    const values = sys.params.map((p) => p.resolve(ctx));
    sys.fn(...values);
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
