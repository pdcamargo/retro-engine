import { CameraPlugin } from './camera/camera-plugin';
import { RemovedComponents } from './change-detection';
import { Children, Parent, propagateTransformsGated } from './hierarchy';
import { ImagePlugin } from './image/image-plugin';
import type { App } from './index';
import { MeshPlugin } from './mesh/mesh-plugin';
import type { PluginObject } from './plugin';
import { RenderGraphPlugin } from './render-graph/render-graph-plugin';
import { ShaderPlugin } from './shader/shader-plugin';
import { Query, ResMut } from './system-param';
import { Time } from './time';
import { TonemappingPlugin } from './tonemapping/tonemapping-plugin';
import { Transform } from './transform';
import { VisibilityPlugin } from './visibility/visibility-plugin';

/**
 * Engine-internal plugin that wires every framework-essential system the
 * engine guarantees to run. Registered first by the `App` constructor —
 * before any user-supplied plugin — so user code observes `Time`,
 * propagated transforms, and hierarchy lifecycle behaviour with no
 * additional setup.
 *
 * Current responsibilities:
 *
 * - Insert the {@link Time} resource so gameplay code can read it via
 *   `Res(Time)` / `ResMut(Time)`.
 * - Register the `Time.tick` system in `'first'`, so every frame begins
 *   with one canonical clock advance.
 * - Register the transform propagation system in `'postUpdate'`, so every
 *   entity's `GlobalTransform` is up-to-date before render reads it.
 * - Register hierarchy lifecycle hooks so `cmd.entity(e).despawn()`
 *   cascades through `Children` and detaches the dying entity from its
 *   parent's `Children` list.
 *
 * Future engine-internal systems (renderer scheduling, input polling, asset
 * loading drivers, scene-loading hooks) follow the same pattern: register
 * a built-in plugin and have the `App` constructor add it before user
 * plugins. This keeps the framework introspectable — enumerate plugins and
 * you see every system the engine is running, including its own.
 *
 * `isUnique()` returns true. A consumer cannot accidentally double-wire
 * the framework's own systems.
 */
export class CorePlugin implements PluginObject {
  name(): string {
    return 'CorePlugin';
  }

  build(app: App): void {
    app.insertResource(new Time());
    app.addSystem('first', [ResMut(Time)], (time) => {
      time.tick(app.currentFrameTimestamp());
    });
    app.addSystem(
      'postUpdate',
      [
        Query([Transform], { changed: [Transform] }),
        Query([Parent], { changed: [Parent] }),
        RemovedComponents(Parent),
      ],
      (changedTransforms, changedParents, removedParents) => {
        propagateTransformsGated(
          app.world,
          app.logger,
          changedTransforms,
          changedParents,
          removedParents,
        );
      },
    );
    app.registerComponentHook(Children, 'onRemove', (ctx) => {
      for (const child of ctx.value.entities) {
        if (ctx.world.hasEntity(child)) ctx.commands.despawn(child);
      }
    });
    app.registerComponentHook(Parent, 'onRemove', (ctx) => {
      const parentEntity = ctx.value.entity;
      if (!ctx.world.hasEntity(parentEntity)) return;
      const siblings = ctx.world.getComponent(parentEntity, Children);
      if (!siblings) return;
      const idx = siblings.entities.indexOf(ctx.entity);
      if (idx >= 0) siblings.entities.splice(idx, 1);
    });
    app.addPlugin(new ShaderPlugin());
    app.addPlugin(new CameraPlugin());
    app.addPlugin(new MeshPlugin());
    app.addPlugin(new ImagePlugin());
    app.addPlugin(new VisibilityPlugin());
    app.addPlugin(new RenderGraphPlugin());
    app.addPlugin(new TonemappingPlugin());
  }
}
