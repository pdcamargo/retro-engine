import { parse as parseToml } from 'smol-toml';

/**
 * The parsed `project.retroengine` descriptor — the human-authored fields of a
 * Retro Engine project's manifest. This is the file-level contract every tool
 * (studio, build CLI, standalone runtime) reads to locate a project's entry
 * point, startup scene, and metadata.
 */
export interface ProjectDescriptor {
  /** Manifest schema version. `0` when absent or non-numeric. */
  readonly formatVersion: number;
  /** Stable unique id for the project (a UUID). Keys per-project tooling state. */
  readonly projectId: string;
  /** Display name of the game. */
  readonly name: string;
  /** Semantic version of the game, e.g. `"0.1.0"`. Defaults to `"0.0.0"`. */
  readonly version: string;
  /** The `@retro-engine` version the project was created against. */
  readonly engine: string;
  /** Project-relative path of the game-runtime entry, e.g. `"src/game.ts"`. */
  readonly buildEntry: string;
  /** Project-relative path of the studio-only editor entry, or `null`. */
  readonly editorEntry: string | null;
  /** GUID (or location) of the scene to load on startup, or `null` if none. */
  readonly startupScene: string | null;
}

/**
 * Parse a `project.retroengine` TOML document into a {@link ProjectDescriptor}.
 *
 * Tolerant of missing tables/fields: unknown or absent values fall back to
 * sensible defaults (`buildEntry` → `"src/game.ts"`, `version` → `"0.0.0"`,
 * optional strings → `null`), so a partial descriptor never throws.
 */
export const parseProjectDescriptor = (toml: string): ProjectDescriptor => {
  const doc = parseToml(toml) as Record<string, unknown>;
  const table = (key: string): Record<string, unknown> =>
    (doc[key] as Record<string, unknown> | undefined) ?? {};
  const project = table('project');
  const build = table('build');
  const run = table('run');
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null;

  return {
    formatVersion: typeof doc.formatVersion === 'number' ? doc.formatVersion : 0,
    projectId: str(doc.projectId),
    name: str(project.name),
    version: str(project.version, '0.0.0'),
    engine: str(project.engine),
    buildEntry: str(build.entry, 'src/game.ts'),
    editorEntry: strOrNull(build.editorEntry),
    startupScene: strOrNull(run.startupScene),
  };
};
