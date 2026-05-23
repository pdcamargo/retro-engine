import type { App, PluginObject } from '@retro-engine/engine';

/**
 * Class-shape witness for the M2 phase 8 plugin lifecycle. Logs each
 * lifecycle hook so an operator running the playground can see the
 * Building → Ready → Cleaned state machine fire end-to-end:
 *
 * 1. `[logging] build` — runs at `app.addPlugin(...)` time.
 * 2. `[logging] ready` — runs at the start of the first `advanceFrame`.
 * 3. `[logging] finish` — runs once every plugin reports ready.
 * 4. `[logging] cleanup` — runs immediately after finish on the same frame.
 *
 * Synchronous plugin so the transitions all collapse onto the first frame;
 * subsequent frames produce no further lifecycle output, only the regular
 * triangle render and the existing transform-debug logs.
 */
export class LoggingPlugin implements PluginObject {
  name(): string {
    return 'LoggingPlugin';
  }

  isUnique(): boolean {
    return true;
  }

  build(app: App): void {
    app.logger.child('logging').info('build');
  }

  ready(app: App): boolean {
    app.logger.child('logging').info('ready');
    return true;
  }

  finish(app: App): void {
    app.logger.child('logging').info('finish');
  }

  cleanup(app: App): void {
    app.logger.child('logging').info('cleanup');
  }
}
