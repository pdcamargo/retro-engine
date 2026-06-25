import type { Entity } from '@retro-engine/ecs';
import { t } from '@retro-engine/reflect';

import { AoPlugin } from './ao/ao-plugin';
import { CameraPlugin } from './camera/camera-plugin';
import { RemovedComponents } from './change-detection';
import { GizmoPlugin } from './gizmos/gizmo-plugin';
import { Children, Parent, propagateTransformsGated } from './hierarchy';
import { CompositionRegistry, CompositionResolverRegistry } from './scene/composition';
import { addCompositionOverrideApply } from './scene/composition-apply';
import { ImagePlugin } from './image/image-plugin';
import type { App } from './index';
import { MeshPlugin } from './mesh/mesh-plugin';
import { MotionBlurPlugin } from './motion-blur/motion-blur-plugin';
import { Name } from './name';
import type { PluginObject } from './plugin';
import { RenderGraphPlugin } from './render-graph/render-graph-plugin';
import { ShaderPlugin } from './shader/shader-plugin';
import { Query, ResMut } from './system-param';
import { TaaPlugin } from './taa/taa-plugin';
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

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    app.insertResource(new Time());
    // The seam plugins extend scene serialization through (extra excluded
    // entities, cross-boundary anchor re-emission). Always present so a plugin's
    // build can register against it; empty until a plugin does.
    app.insertResource(new CompositionRegistry());
    // The load-time counterpart: maps an anchor `kind` to its resolver so the
    // generic override-apply system can re-express a derived entity's edits after
    // its subtree re-instantiates. A plugin registers resolvers in its build.
    app.insertResource(new CompositionResolverRegistry());
    app.addSystem('first', [ResMut(Time)], (time) => {
      time.tick(app.currentFrameTimestamp());
    }, { name: 'time-tick' });
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
      { name: 'transform-propagation' },
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

    // Reflection schemas for the core graph. GlobalTransform and Children are
    // deliberately omitted: the first is recomputed by propagation, the second
    // is rebuilt from each child's Parent edge when a scene is spawned.
    app.registerComponent(
      Transform,
      { translation: t.vec3, rotation: t.quat, scale: t.vec3 },
      { name: 'Transform' },
    );
    app.registerComponent(Name, { value: t.string }, { name: 'Name' });
    app.registerComponent(
      Parent,
      { entity: t.entity() },
      { name: 'Parent', make: () => new Parent(0 as Entity) },
    );

    // Re-apply a loaded scene's edits to derived (instantiated) subtrees once
    // their owning plugin has re-instantiated them and registered a resolver.
    addCompositionOverrideApply(app);

    app.addPlugin(new ShaderPlugin());
    app.addPlugin(new CameraPlugin());
    app.addPlugin(new MeshPlugin());
    app.addPlugin(new ImagePlugin());
    app.addPlugin(new VisibilityPlugin());
    app.addPlugin(new RenderGraphPlugin());
    // Before the HDR post chain: AO runs pre-opaque (it feeds the forward
    // ambient term), so it is independent of tonemap / motion-blur / TAA. Its
    // finish() wires Prepass → AO → Opaque once those nodes exist.
    app.addPlugin(new AoPlugin());
    app.addPlugin(new TonemappingPlugin());
    // After TonemappingPlugin so its finish() (which orders the tonemap node
    // behind motion blur) sees the tonemap node already registered.
    app.addPlugin(new MotionBlurPlugin());
    // After MotionBlurPlugin so its finish() can order the TAA resolve ahead of
    // the blur and tonemap nodes.
    app.addPlugin(new TaaPlugin());
    // Last in the post chain: its finish() orders the gizmo pass after the
    // temporal/post nodes (so handles stay crisp) and before tonemap.
    app.addPlugin(new GizmoPlugin());
  }
}
