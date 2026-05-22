/**
 * Engine diagnostic sink. Used by `App` and engine subsystems to emit
 * categorised, severity-tagged messages. Pass a custom implementation through
 * `AppOptions.logger` to route engine output to a custom destination (a studio
 * log panel, Tauri's tracing layer, a test buffer, telemetry, etc.) without
 * changing any call site.
 *
 * `error` / `warn` / `info` / `debug` are conventional severities and always
 * emit. `devWarn` is the dev-only advisory channel — see its docs. `child`
 * returns a categorised view backed by the same sink.
 */
export interface Logger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
  /**
   * Emit a development-only advisory. The default implementation forwards to
   * `console.warn` when `process.env.NODE_ENV !== 'production'` and is silent
   * otherwise; custom implementations can route however they like. Use this
   * for messages that aid development but would be noise in production
   * (e.g., "replacing an already-registered resource").
   */
  devWarn(msg: string): void;
  /**
   * Return a labelled view that shares this logger's sink and prefixes every
   * emission with `[category]`. Nested children compose: `child('a').child('b')`
   * prefixes with `[a][b]`. Subsystems and plugins capture a child once at
   * setup and reuse it.
   */
  child(category: string): Logger;
}

class ConsoleLogger implements Logger {
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  error(msg: string): void {
    console.error(this.format(msg));
  }

  warn(msg: string): void {
    console.warn(this.format(msg));
  }

  info(msg: string): void {
    console.info(this.format(msg));
  }

  debug(msg: string): void {
    console.debug(this.format(msg));
  }

  devWarn(msg: string): void {
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.warn(this.format(msg));
    }
  }

  child(category: string): Logger {
    return new ConsoleLogger(`${this.prefix}[${category}]`);
  }

  private format(msg: string): string {
    return this.prefix === '' ? msg : `${this.prefix} ${msg}`;
  }
}

/**
 * Build a fresh logger that writes to `console.*`. Use this when you need a
 * dedicated logger instance (e.g., in tests that assert against a private
 * spy); for ordinary engine use, the shared {@link engineLogger} is enough.
 */
export const createConsoleLogger = (): Logger => new ConsoleLogger('');

/**
 * Process-wide default `Logger`. Used by `App` when `AppOptions.logger` is
 * omitted, and available to engine-adjacent utility code that runs without an
 * `App` in scope. Most code should prefer `app.logger` (or a child captured
 * at plugin-build time) so a per-App override via `AppOptions.logger` is
 * honoured.
 */
export const engineLogger: Logger = createConsoleLogger();
