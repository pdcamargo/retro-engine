import type {
  CommandEncoder,
  Renderer,
  RenderPassEncoder,
  Surface,
  TextureView,
} from '@retro-engine/renderer-core';
import { World } from '@retro-engine/ecs';

import type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
import { RunCondition } from './system-param';

export type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
export { RenderCtx, Res, RunCondition } from './system-param';

/** A plugin extends an `App` by registering systems, resources, and component types. */
export type Plugin = (app: App) => void;

/** Named stage in the schedule — when a system runs within a frame. */
export type Stage = 'startup' | 'preUpdate' | 'update' | 'postUpdate' | 'render';

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
  private readonly systems: {
    startup: RegisteredSystem[];
    preUpdate: RegisteredSystem[];
    update: RegisteredSystem[];
    postUpdate: RegisteredSystem[];
    render: RegisteredSystem[];
  } = {
    startup: [],
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

  constructor(options: AppOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
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
   * via the `Res(ctor)` param. Inserting a second value of the same class
   * replaces the prior instance.
   */
  insertResource<T extends object>(value: T): this {
    this.resources.set(value.constructor, value);
    return this;
  }

  /**
   * Look up a resource by constructor. Returns `undefined` if no resource of
   * that class was inserted. Most code should use the `Res(ctor)` param
   * instead; this is the escape hatch the param resolver itself relies on.
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

    const tick = (): void => {
      if (!this.running) return;
      this.runStage('preUpdate');
      this.runStage('update');
      this.runStage('postUpdate');
      this.renderFrame();
      this.rafHandle =
        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : undefined;
    };

    tick();
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
