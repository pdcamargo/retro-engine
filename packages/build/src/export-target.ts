/**
 * Context handed to an {@link ExportTarget} describing what to export and where.
 * Fleshed out by the web adapter phase; the shape is fixed here so targets and
 * the registry can be typed now.
 */
export interface ExportContext {
  /** Absolute path to the project root being exported. */
  readonly projectRoot: string;
  /** Absolute path to the output directory the artifact is written into. */
  readonly outDir: string;
  /** Whether to emit production-optimized output (minify, no source maps). */
  readonly production: boolean;
}

/** Outcome of an export run. */
export interface ExportResult {
  /** Absolute paths of the files the export produced. */
  readonly outputs: readonly string[];
}

/**
 * A pluggable export backend — e.g. `'web'` (static site + `.rpak`), later
 * desktop/console. Registered in an {@link ExportRegistry}; composition over a
 * base class (ADR-0001), mirroring the renderer-backend and asset-loader shapes.
 */
export interface ExportTarget {
  /** Unique target name, e.g. `'web'`. */
  readonly name: string;
  /** Produce the deployable artifact for `ctx`. */
  export(ctx: ExportContext): Promise<ExportResult>;
}

/** Registry of {@link ExportTarget}s, keyed by {@link ExportTarget.name}. */
export class ExportRegistry {
  readonly #targets = new Map<string, ExportTarget>();

  /** Register `target`; a later registration for the same name replaces it. */
  register(target: ExportTarget): void {
    this.#targets.set(target.name, target);
  }

  /** The target registered under `name`, or `undefined`. */
  get(name: string): ExportTarget | undefined {
    return this.#targets.get(name);
  }

  /** Every registered target name. */
  get names(): string[] {
    return [...this.#targets.keys()];
  }
}
