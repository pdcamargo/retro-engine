import { hostExternalsPlugin } from './host-externals-plugin';

/** Inputs to {@link buildProject}. */
export interface BuildProjectOptions {
  /** Absolute path to the project's game-runtime entry (e.g. `<dir>/src/game.ts`). */
  readonly entrypoint: string;
}

/** Result of a successful {@link buildProject}. */
export interface BuildProjectResult {
  /** The bundled ESM module text, with `@retro-engine/*` resolved to the host at runtime. */
  readonly code: string;
}

/**
 * Bundle a project's entry into a single ESM module, with `@retro-engine/*`
 * resolved to the studio's live instances (see {@link hostExternalsPlugin}).
 * Identifier minification is kept off so component `ctor.name`s survive (ADR-0088;
 * Bun's `--keep-names` is a no-op, bun#25332). Runs under Bun (dev server or the
 * native sidecar) — never in the browser.
 */
export const buildProject = async (opts: BuildProjectOptions): Promise<BuildProjectResult> => {
  const result = await Bun.build({
    entrypoints: [opts.entrypoint],
    target: 'browser',
    format: 'esm',
    minify: { whitespace: true, syntax: true, identifiers: false },
    plugins: [hostExternalsPlugin()],
  });

  if (!result.success) {
    throw new Error(`buildProject failed:\n${result.logs.map((l) => String(l)).join('\n')}`);
  }
  const output = result.outputs[0];
  if (output === undefined) {
    throw new Error('buildProject produced no output');
  }
  return { code: await output.text() };
};
