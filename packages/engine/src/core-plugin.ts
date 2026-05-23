import { propagateTransforms } from './hierarchy';
import type { App } from './index';
import type { PluginObject } from './plugin';
import { ResMut } from './system-param';
import { Time } from './time';

/**
 * Engine-internal plugin that wires every framework-essential system the
 * engine guarantees to run. Registered first by the `App` constructor —
 * before any user-supplied plugin — so user code observes `Time` and
 * propagated transforms with no additional setup.
 *
 * Current responsibilities:
 *
 * - Insert the {@link Time} resource so gameplay code can read it via
 *   `Res(Time)` / `ResMut(Time)`.
 * - Register the `Time.tick` system in `'first'`, so every frame begins
 *   with one canonical clock advance.
 * - Register the transform propagation system in `'postUpdate'`, so every
 *   entity's `GlobalTransform` is up-to-date before render reads it.
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
    app.addSystem('postUpdate', [], () => {
      propagateTransforms(app.world, app.logger);
    });
  }
}
