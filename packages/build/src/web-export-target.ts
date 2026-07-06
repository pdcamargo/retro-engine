import type { ExportContext, ExportResult, ExportTarget } from './export-target';
import type { RpakInput } from './rpak-writer';
import { writeRpak } from './rpak-writer';
import { bundleUserCode } from './web-bundle';
import { emitIndexHtml } from './web-index-html';

/** Configuration for a {@link WebExportTarget}. */
export interface WebExportConfig {
  /** Absolute path to the user code entry module. */
  readonly entrypoint: string;
  /** Package names to leave external (default none — self-contained bundle). */
  readonly external?: readonly string[];
  /** Project assets to pack into the `.rpak`. Omit/empty to skip the archive. */
  readonly assets?: readonly RpakInput[];
  /** Document title for the generated `index.html`. */
  readonly title?: string;
  /** Filename for the entry bundle. Default `'main.js'`. */
  readonly bundleName?: string;
  /** Filename for the asset archive. Default `'assets.rpak'`. */
  readonly rpakName?: string;
}

/**
 * The `'web'` {@link ExportTarget}: bundles the project's user code for the
 * browser (Bun bundler), writes the bundle + a generated `index.html`, and packs
 * the project's assets into a `.rpak` beside it — a static site deployable to any
 * host. Runs under Bun/Node at build time.
 */
export class WebExportTarget implements ExportTarget {
  readonly name = 'web';

  constructor(private readonly config: WebExportConfig) {}

  async export(ctx: ExportContext): Promise<ExportResult> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join, basename } = await import('node:path');

    await mkdir(ctx.outDir, { recursive: true });
    const outputs: string[] = [];

    const bundle = await bundleUserCode({
      entrypoints: [this.config.entrypoint],
      ...(this.config.external !== undefined ? { external: this.config.external } : {}),
      minify: ctx.production,
      sourcemap: ctx.production ? 'none' : 'external',
      target: 'browser',
    });
    if (!bundle.success) {
      throw new Error(`web export: user code bundle failed:\n${bundle.logs.join('\n')}`);
    }

    const bundleName = this.config.bundleName ?? 'main.js';
    for (const artifact of bundle.artifacts) {
      const name = artifact.kind === 'entry-point' ? bundleName : basename(artifact.path);
      const dest = join(ctx.outDir, name);
      await writeFile(dest, await artifact.bytes());
      outputs.push(dest);
    }

    let rpakName: string | undefined;
    if (this.config.assets !== undefined && this.config.assets.length > 0) {
      rpakName = this.config.rpakName ?? 'assets.rpak';
      const dest = join(ctx.outDir, rpakName);
      await writeFile(dest, await writeRpak(this.config.assets));
      outputs.push(dest);
    }

    const html = emitIndexHtml({
      bundlePath: bundleName,
      ...(this.config.title !== undefined ? { title: this.config.title } : {}),
      ...(rpakName !== undefined ? { rpakPath: rpakName } : {}),
    });
    const indexDest = join(ctx.outDir, 'index.html');
    await writeFile(indexDest, html);
    outputs.push(indexDest);

    return { outputs };
  }
}
