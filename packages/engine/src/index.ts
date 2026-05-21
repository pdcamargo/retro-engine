import type { Renderer } from '@retro-engine/renderer-core';
import { World } from '@retro-engine/ecs';

/** A plugin extends an `App` by registering systems, resources, and component types. */
export type Plugin = (app: App) => void;

/** Named stage in the schedule — when a system runs within a frame. */
export type Stage = 'startup' | 'preUpdate' | 'update' | 'postUpdate' | 'render';

export type SystemFn = (world: World) => void;

/**
 * Day-1 `App`: holds a `World`, accepts plugins, and runs a stop-able frame
 * loop. Bevy-shaped, but tiny — real scheduling and resource management land
 * later.
 */
export class App {
  readonly world = new World();
  private readonly systems = new Map<Stage, SystemFn[]>();
  private readonly renderer: Renderer;
  private running = false;
  private rafHandle: number | undefined;

  constructor(options: { renderer: Renderer }) {
    this.renderer = options.renderer;
  }

  addPlugin(plugin: Plugin): this {
    plugin(this);
    return this;
  }

  addSystem(stage: Stage, system: SystemFn): this {
    const list = this.systems.get(stage) ?? [];
    list.push(system);
    this.systems.set(stage, list);
    return this;
  }

  /** Start the frame loop. Resolves once `stop()` is called. */
  async run(): Promise<void> {
    await this.renderer.init();
    this.runStage('startup');
    this.running = true;

    const tick = (): void => {
      if (!this.running) return;
      this.runStage('preUpdate');
      this.runStage('update');
      this.runStage('postUpdate');
      this.runStage('render');
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
    this.renderer.destroy();
  }

  private runStage(stage: Stage): void {
    const list = this.systems.get(stage);
    if (!list) return;
    for (const system of list) system(this.world);
  }
}
