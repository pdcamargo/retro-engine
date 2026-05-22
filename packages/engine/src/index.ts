import type {
  CommandEncoder,
  Renderer,
  RenderPassEncoder,
  Surface,
  TextureView,
} from '@retro-engine/renderer-core';
import { World } from '@retro-engine/ecs';

/** A plugin extends an `App` by registering systems, resources, and component types. */
export type Plugin = (app: App) => void;

/** Named stage in the schedule — when a system runs within a frame. */
export type Stage = 'startup' | 'preUpdate' | 'update' | 'postUpdate' | 'render';

/** Non-render-stage systems operate on the world only. */
export type SystemFn = (world: World) => void;

/**
 * Per-frame context handed to render-stage systems. The encoder and pass
 * are scoped to the current frame and become invalid once the frame ends —
 * do not retain them across systems or across ticks.
 */
export interface RenderContext {
  readonly encoder: CommandEncoder;
  readonly pass: RenderPassEncoder;
  readonly surfaceView: TextureView;
}

/** Render-stage systems read the world and record draws into the frame's pass. */
export type RenderSystemFn = (world: World, ctx: RenderContext) => void;

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

/**
 * Day-1 `App`: holds a `World`, accepts plugins, and runs a stop-able frame
 * loop. Bevy-shaped, but tiny — real scheduling and resource management land
 * later.
 *
 * When a canvas is provided, the render stage drives a single main render
 * pass per frame: the engine acquires the swapchain view, begins a pass
 * that clears to {@link AppOptions.clearColor}, invokes each registered
 * render system with the encoder, ends the pass, and submits. A future
 * render-graph layer supersedes this one-pass-per-frame model once multiple
 * passes exist.
 */
export class App {
  readonly world = new World();
  /** Backend renderer the app drives. Plugins use this to build shader modules, pipelines, and other GPU resources. */
  readonly renderer: Renderer;
  private readonly systems = new Map<Exclude<Stage, 'render'>, SystemFn[]>();
  private readonly renderSystems: RenderSystemFn[] = [];
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly clearColor: { r: number; g: number; b: number; a: number };
  private surface: Surface | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private running = false;
  private rafHandle: number | undefined;

  constructor(options: AppOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
  }

  addPlugin(plugin: Plugin): this {
    plugin(this);
    return this;
  }

  addSystem(stage: 'render', system: RenderSystemFn): this;
  addSystem(stage: Exclude<Stage, 'render'>, system: SystemFn): this;
  addSystem(stage: Stage, system: SystemFn | RenderSystemFn): this {
    if (stage === 'render') {
      this.renderSystems.push(system as RenderSystemFn);
    } else {
      const list = this.systems.get(stage) ?? [];
      list.push(system as SystemFn);
      this.systems.set(stage, list);
    }
    return this;
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
    const ctx: RenderContext = { encoder, pass, surfaceView };
    for (const system of this.renderSystems) system(this.world, ctx);
    pass.end();
    this.renderer.submit([encoder.finish()]);
  }

  private runStage(stage: Exclude<Stage, 'render'>): void {
    const list = this.systems.get(stage);
    if (!list) return;
    for (const system of list) system(this.world);
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
