/**
 * Configuration for {@link bundleUserCode}. A thin, typed pass-through over the
 * subset of Bun bundler options the web export target needs.
 */
export interface BundleConfig {
  /** Entry module path(s) to bundle. */
  readonly entrypoints: readonly string[];
  /** Directory to write outputs to; omit to keep artifacts in memory. */
  readonly outdir?: string;
  /**
   * Package names to leave as bare imports rather than inline. Empty (the web
   * export default) bundles the engine + deps into a self-contained browser
   * artifact; the studio's live build externalizes the engine to the host.
   */
  readonly external?: readonly string[];
  /** Minify the output (production builds). Default `false`. */
  readonly minify?: boolean;
  /** Source-map mode. Default `'none'`. */
  readonly sourcemap?: 'none' | 'inline' | 'external';
  /** Execution target. Default `'browser'`. */
  readonly target?: 'browser' | 'bun' | 'node';
}

/** One emitted bundle file. */
export interface BundleArtifact {
  /** Output path (relative to `outdir`, or a synthetic name for in-memory). */
  readonly path: string;
  /** Artifact role, e.g. `'entry-point'`, `'chunk'`, `'sourcemap'`, `'asset'`. */
  readonly kind: string;
  /** The artifact's text contents. */
  text(): Promise<string>;
  /** The artifact's raw bytes. */
  bytes(): Promise<Uint8Array>;
}

/** Result of a bundle run. */
export interface BundleResult {
  readonly success: boolean;
  readonly artifacts: readonly BundleArtifact[];
  /** Bundler diagnostics, stringified. */
  readonly logs: readonly string[];
}

interface BunBlobArtifact {
  readonly path: string;
  readonly kind: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Bundle a project's user code for the browser via the Bun bundler. Defaults to
 * `target: 'browser'`, ESM output, no externals (a self-contained bundle). The
 * export pipeline runs under Bun; throws with a clear message if the Bun bundler
 * is unavailable (an esbuild fallback is a later phase).
 */
export const bundleUserCode = async (config: BundleConfig): Promise<BundleResult> => {
  const bun = (globalThis as { Bun?: { build?: unknown } }).Bun;
  if (bun === undefined || typeof bun.build !== 'function') {
    throw new Error(
      'bundleUserCode: the Bun bundler is required — run the web export under Bun (an esbuild fallback is planned).',
    );
  }
  const build = bun.build as (opts: Record<string, unknown>) => Promise<{
    success: boolean;
    outputs: BunBlobArtifact[];
    logs: unknown[];
  }>;
  const result = await build({
    entrypoints: [...config.entrypoints],
    target: config.target ?? 'browser',
    format: 'esm',
    external: [...(config.external ?? [])],
    minify: config.minify ?? false,
    sourcemap: config.sourcemap ?? 'none',
    ...(config.outdir !== undefined ? { outdir: config.outdir } : {}),
  });
  return {
    success: result.success,
    artifacts: result.outputs.map((output) => ({
      path: output.path,
      kind: output.kind,
      text: () => output.text(),
      bytes: async () => new Uint8Array(await output.arrayBuffer()),
    })),
    logs: result.logs.map((log) => String(log)),
  };
};
