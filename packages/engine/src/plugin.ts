import type { App } from './index';

/**
 * The App's plugin lifecycle phase.
 *
 * - `'Building'` — the App is still accepting plugin registrations. Every
 *   `app.addPlugin(...)` / `app.addPlugins(...)` call must happen while the
 *   App is in this state. Each plugin's `build(app)` runs synchronously at
 *   registration time. This is the App's initial state.
 * - `'Ready'` — every registered plugin reported `ready()` true and the App
 *   has invoked `finish(app)` on each, in registration order. The schedule
 *   is now driving frames. `addPlugin` after this point throws.
 * - `'Cleaned'` — `cleanup(app)` has run for every plugin, in registration
 *   order, releasing any build-time scaffolding the plugin no longer needs.
 *   For synchronous plugins (the common case), the very first
 *   {@link App.advanceFrame} call transitions Building → Ready → Cleaned in
 *   one tick before any system runs.
 */
export type PluginsState = 'Building' | 'Ready' | 'Cleaned';

/**
 * Composable unit that extends an `App` by registering systems, resources,
 * and component types. This is the canonical shape — a class implementing
 * {@link PluginObject} is the recommended way to write a plugin in new
 * code. The lifecycle hooks run in this order:
 *
 * 1. `build(app)` — synchronous, called by `app.addPlugin(plugin)` while the
 *    App is in `'Building'`. Register systems, insert resources, declare
 *    state machines here. This is the only hook every plugin must implement.
 * 2. `ready(app)` — polled at the start of every `advanceFrame` while the
 *    App is in `'Building'`. Defaults to `true`. Plugins with async setup
 *    (e.g. a shader the plugin requested in `build` and is awaiting) flip a
 *    private flag in their resolved callback and return that flag here.
 * 3. `finish(app)` — runs once, after every plugin has reported `ready()`
 *    true, in registration order. Use for late wiring that needs to observe
 *    every plugin's `build` effects.
 * 4. `cleanup(app)` — runs once after `finish`, in registration order. For
 *    one-shot teardown of build-time scaffolding the plugin no longer
 *    needs. `cleanup` must not depend on other plugins' state — it tears
 *    down the plugin's *own* scaffolding, never reaches across the registry.
 *
 * `name()` is the uniqueness key. By default a plugin is unique by name —
 * a second `addPlugin` with the same `name()` throws. Override
 * `isUnique()` to return `false` for plugins that may be added multiple
 * times.
 *
 * Function-callback plugins ({@link PluginFn}) passed to `addPlugin` are
 * auto-wrapped into this shape; see {@link wrapFunctionPlugin}.
 */
export interface PluginObject {
  /**
   * Stable identifier for this plugin. Used as the uniqueness key when
   * `isUnique()` is true, and surfaced in lifecycle diagnostics. Auto-wrapped
   * function plugins use `fn.name` when non-empty.
   */
  name(): string;
  /**
   * Whether this plugin may appear at most once per App. Defaults to true
   * for class plugins and named function plugins; false for anonymous
   * function plugins (uniqueness is meaningless for anonymous code).
   */
  isUnique?(): boolean;
  /**
   * Primary registration hook. Synchronous; runs at `addPlugin` time while
   * the App is in `'Building'`. Register systems, resources, and component
   * types here.
   */
  build(app: App): void;
  /**
   * Optional readiness gate. Polled at the start of every
   * {@link App.advanceFrame} while the App is in `'Building'`. Defaults to
   * `true` if omitted. Once a plugin reports `true`, the App caches that
   * answer and stops polling this plugin.
   */
  ready?(app: App): boolean;
  /**
   * Optional late-wiring hook. Runs once, in registration order, after
   * every plugin has reported `ready()` true.
   */
  finish?(app: App): void;
  /**
   * Optional one-shot teardown of the plugin's own build-time scaffolding.
   * Runs once, in registration order, after every plugin's `finish` has
   * completed. Must not depend on other plugins' state.
   */
  cleanup?(app: App): void;
}

/**
 * Legacy function-callback plugin shape — `(app: App) => void`. The pre-M2-
 * phase-8 form, retained because the auto-wrap path at `App.addPlugin` is
 * load-bearing for existing call sites. New code should prefer
 * {@link PluginObject} (a class) for anything richer than a one-liner.
 *
 * When `app.addPlugin(fn)` is called with a function, the App wraps it into
 * a `PluginObject` whose `build(app)` calls `fn(app)`. The wrapper's
 * `name()` derives from `fn.name`; anonymous functions are non-unique.
 */
export type PluginFn = (app: App) => void;

/**
 * The type accepted by `App.addPlugin`. A union of the canonical
 * {@link PluginObject} shape (recommended for new code) and the legacy
 * {@link PluginFn} callback shape (auto-wrapped by `addPlugin`).
 *
 * Tooling note: when writing a *new* class plugin, declare
 * `class MyPlugin implements PluginObject { ... }` — `Plugin` is a union
 * type and is not directly implementable.
 */
export type Plugin = PluginObject | PluginFn;

let anonymousCounter = 0;

const ANONYMOUS_NAME_PREFIX = '<anonymous-';

/**
 * Internal wrapper that adapts a `(app: App) => void` function to the full
 * {@link Plugin} shape. Named function plugins are unique by their
 * `fn.name`; anonymous function plugins are not unique and carry a
 * generated `<anonymous-N>` name (uniqueness for anonymous code is
 * meaningless — every `() => {...}` is its own distinct definition).
 *
 * @internal
 */
class FunctionPlugin implements PluginObject {
  private readonly _name: string;
  private readonly _isUnique: boolean;

  constructor(private readonly fn: PluginFn) {
    const fnName = fn.name;
    if (fnName) {
      this._name = fnName;
      this._isUnique = true;
    } else {
      anonymousCounter += 1;
      this._name = `${ANONYMOUS_NAME_PREFIX}${anonymousCounter}>`;
      this._isUnique = false;
    }
  }

  name(): string {
    return this._name;
  }

  isUnique(): boolean {
    return this._isUnique;
  }

  build(app: App): void {
    this.fn(app);
  }
}

/**
 * Type-guard distinguishing a function-callback plugin from an object
 * implementing the {@link PluginObject} interface.
 *
 * @internal
 */
export const isFunctionPlugin = (p: Plugin): p is PluginFn => typeof p === 'function';

/**
 * Auto-wrap a function-callback plugin into the canonical
 * {@link PluginObject} shape. Returns the input unchanged if it already
 * implements `PluginObject`. Used by `App.addPlugin` to support the
 * function call shape; not part of the public API but exported for tests.
 *
 * @internal
 */
export const wrapFunctionPlugin = (p: Plugin): PluginObject =>
  isFunctionPlugin(p) ? new FunctionPlugin(p) : p;
