import type { AssetManifestFile } from '@retro-engine/assets';
import { serializeAssetManifest } from '@retro-engine/assets';

import type { ExportContext, ExportResult, ExportTarget } from './export-target';
import type { RpakInput } from './rpak-writer';
import { writeRpak } from './rpak-writer';
import { emitWebBoot } from './web-boot';
import { bundleUserCode } from './web-bundle';
import { emitIndexHtml } from './web-index-html';

/** Configuration for a {@link WebExportTarget}. */
export interface WebExportConfig {
  /** Absolute path to the user code entry module (default-exports a `ProjectDefinition`). */
  readonly entrypoint: string;
  /**
   * Package names to leave external (default `@retro-engine/runtime-web` is
   * bundled → a self-contained artifact). Callers rarely set this; the export
   * test uses it to keep the bundle tiny.
   */
  readonly external?: readonly string[];
  /** Project assets to pack into the `.rpak`. Omit/empty to skip the archive. */
  readonly assets?: readonly RpakInput[];
  /**
   * GUID→location asset manifest. When present it is written as `manifest.json`
   * beside the bundle so the runtime can resolve GUIDs to `.rpak` entries.
   */
  readonly manifest?: AssetManifestFile;
  /** Document title for the generated `index.html`. */
  readonly title?: string;
  /** Filename for the entry bundle. Default `'main.js'`. */
  readonly bundleName?: string;
  /** Filename for the asset archive. Default `'assets.rpak'`. */
  readonly rpakName?: string;
  /** Swapchain clear color forwarded to the runtime. */
  readonly clearColor?: { r: number; g: number; b: number; a: number };
  /**
   * GUID of the project's startup scene, forwarded to the generated boot entry
   * so a scene-driven project boots with its authored world (ADR-0173).
   */
  readonly startupScene?: string;
}

// A hidden file written into the project root: the generated boot entry.
// Bundling from inside the project tree keeps `@retro-engine/*` resolution
// walking up through the project's node_modules; a temporary file, removed after
// the bundle.
const BOOT_ENTRY_NAME = '.retro-web-boot-entry.ts';

/**
 * The `'web'` {@link ExportTarget}: generates a boot entry that hands the
 * project's `ProjectDefinition` to `bootWebGame`, bundles it for the browser
 * (Bun bundler — engine + backend inlined), writes the bundle + a generated
 * `index.html`, and packs the project's assets into a `.rpak` beside it — a
 * static site deployable to any host. Runs under Bun/Node at build time.
 */
export class WebExportTarget implements ExportTarget {
  readonly name = 'web';

  constructor(private readonly config: WebExportConfig) {}

  async export(ctx: ExportContext): Promise<ExportResult> {
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const { join, basename, relative } = await import('node:path');

    await mkdir(ctx.outDir, { recursive: true });
    const outputs: string[] = [];

    // Import the user entry by a path relative to the boot entry (which lives in
    // the project root), normalized to a POSIX specifier so it is a valid ESM import.
    const userEntrySpecifier = relative(ctx.projectRoot, this.config.entrypoint)
      .split('\\')
      .join('/');
    const rpakName = this.config.rpakName ?? 'assets.rpak';
    const packsAssets =
      this.config.assets !== undefined &&
      this.config.assets.length > 0 &&
      this.config.manifest !== undefined &&
      this.config.manifest.entries.length > 0;
    const bootEntryPath = join(ctx.projectRoot, BOOT_ENTRY_NAME);
    await writeFile(
      bootEntryPath,
      emitWebBoot({
        userEntry: userEntrySpecifier.startsWith('.')
          ? userEntrySpecifier
          : `./${userEntrySpecifier}`,
        ...(this.config.clearColor !== undefined ? { clearColor: this.config.clearColor } : {}),
        ...(packsAssets ? { assets: { rpakUrl: rpakName, manifestUrl: 'manifest.json' } } : {}),
        ...(this.config.startupScene !== undefined ? { startupScene: this.config.startupScene } : {}),
      }),
    );

    try {
      const bundle = await bundleUserCode({
        entrypoints: [bootEntryPath],
        ...(this.config.external !== undefined ? { external: this.config.external } : {}),
        // Keep constructor names in production (identifiers: false) — the engine's
        // reflection-based scene serialization keys on them, so renaming classes
        // would break saved-scene round-trips in the shipped game.
        minify: ctx.production ? { whitespace: true, syntax: true, identifiers: false } : false,
        // Inline in dev so the single `main.js` is self-describing (an external
        // map would carry the internal boot-entry basename). Production ships no map.
        sourcemap: ctx.production ? 'none' : 'inline',
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

      let wroteRpak = false;
      if (this.config.assets !== undefined && this.config.assets.length > 0) {
        const dest = join(ctx.outDir, rpakName);
        await writeFile(dest, await writeRpak(this.config.assets));
        outputs.push(dest);
        wroteRpak = true;
      }

      if (this.config.manifest !== undefined && this.config.manifest.entries.length > 0) {
        const dest = join(ctx.outDir, 'manifest.json');
        await writeFile(dest, serializeAssetManifest(this.config.manifest));
        outputs.push(dest);
      }

      const html = emitIndexHtml({
        bundlePath: bundleName,
        ...(this.config.title !== undefined ? { title: this.config.title } : {}),
        ...(wroteRpak ? { rpakPath: rpakName } : {}),
      });
      const indexDest = join(ctx.outDir, 'index.html');
      await writeFile(indexDest, html);
      outputs.push(indexDest);

      return { outputs };
    } finally {
      await rm(bootEntryPath, { force: true });
    }
  }
}
