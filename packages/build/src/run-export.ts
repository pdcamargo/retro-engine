import { parseProjectDescriptor, type ProjectDescriptor } from '@retro-engine/project';

import { scanProjectAssets } from './asset-scan';
import { WebExportTarget } from './web-export-target';

/** Options for {@link runWebExport}. */
export interface RunWebExportOptions {
  /** Absolute path to the project root (the directory holding `project.retroengine`). */
  readonly projectRoot: string;
  /** Output directory. Defaults to `<projectRoot>/dist/web`. */
  readonly outDir?: string;
  /** Emit production-optimized output (minify with names preserved, no source maps). */
  readonly production?: boolean;
  /** Package names to leave external. Rarely set; tests use it to shrink the bundle. */
  readonly external?: readonly string[];
}

/** Result of {@link runWebExport}. */
export interface RunWebExportResult {
  /** Absolute paths of the files the export produced. */
  readonly outputs: readonly string[];
  /** The output directory the artifact was written into. */
  readonly outDir: string;
  /** The parsed project descriptor that drove the export. */
  readonly descriptor: ProjectDescriptor;
}

/**
 * Export a Retro Engine project to a static web artifact.
 *
 * Reads the project's `project.retroengine`, resolves its build entry, and runs
 * the {@link WebExportTarget} into `outDir` (default `<projectRoot>/dist/web`).
 * The project's `assets/` are not yet packed into the `.rpak` — a project that
 * boots without preloaded assets (or loads them itself) exports and runs today.
 */
export const runWebExport = async (
  options: RunWebExportOptions,
): Promise<RunWebExportResult> => {
  const { readFile, access } = await import('node:fs/promises');
  const { join, isAbsolute } = await import('node:path');

  const descriptorPath = join(options.projectRoot, 'project.retroengine');
  let descriptorText: string;
  try {
    descriptorText = await readFile(descriptorPath, 'utf8');
  } catch {
    throw new Error(`retro build: no project.retroengine found at ${descriptorPath}`);
  }
  const descriptor = parseProjectDescriptor(descriptorText);

  const entrypoint = isAbsolute(descriptor.buildEntry)
    ? descriptor.buildEntry
    : join(options.projectRoot, descriptor.buildEntry);
  try {
    await access(entrypoint);
  } catch {
    throw new Error(
      `retro build: build entry '${descriptor.buildEntry}' not found at ${entrypoint}`,
    );
  }

  const outDir = options.outDir ?? join(options.projectRoot, 'dist', 'web');
  // Pack the project's assets (scanned from `.meta` sidecars) into the `.rpak`
  // and emit the GUID→location manifest beside the bundle.
  const scanned = await scanProjectAssets(options.projectRoot);
  const target = new WebExportTarget({
    entrypoint,
    ...(descriptor.name.length > 0 ? { title: descriptor.name } : {}),
    ...(options.external !== undefined ? { external: options.external } : {}),
    ...(scanned.inputs.length > 0 ? { assets: scanned.inputs, manifest: scanned.manifest } : {}),
  });

  const result = await target.export({
    projectRoot: options.projectRoot,
    outDir,
    production: options.production ?? false,
  });

  return { outputs: result.outputs, outDir, descriptor };
};
