/**
 * Options describing the project to scaffold. Kept free of I/O so the file set
 * can be generated and asserted in tests; the CLI supplies a real `projectId`
 * and writes the returned files to disk.
 */
export interface ScaffoldOptions {
  /** The game's display name and `package.json` name. */
  readonly name: string;
  /** A stable, unique id for the project (a UUID). Keys per-project editor state. */
  readonly projectId: string;
  /** The `@retro-engine` version this project was created against, recorded in the descriptor. */
  readonly engineVersion: string;
  /**
   * The version range written for every `@retro-engine/*` dependency. Defaults
   * to `^{engineVersion}`. Pass a `file:`/`link:` spec to wire a project against
   * a local checkout of the packages.
   */
  readonly dependencySpec?: string;
}

const RETRO_DEPS = [
  '@retro-engine/engine',
  '@retro-engine/project',
  // The web-export runtime host (`bootWebGame`). The generated web-export boot
  // entry imports it, and the export bundles from the project tree — so a project
  // needs it as a dependency to build a runnable web target.
  '@retro-engine/runtime-web',
] as const;
const RETRO_DEV_DEPS = ['@retro-engine/editor-sdk', '@retro-engine/tsconfig'] as const;

const depMap = (names: readonly string[], spec: string): Record<string, string> =>
  Object.fromEntries(names.map((n) => [n, spec]));

/**
 * Produces every file of a fresh Retro Engine project as a `path -> contents`
 * map (paths relative to the project root). Pure: no filesystem access. The
 * layout is `src/game.ts` + optional `src/editor.ts` for code, a free-form
 * `assets/` content root, `editor/settings/` for committed settings, and the
 * `project.retroengine` descriptor.
 */
export function scaffoldProject(options: ScaffoldOptions): Map<string, string> {
  const { name, projectId, engineVersion } = options;
  const spec = options.dependencySpec ?? `^${engineVersion}`;

  const files = new Map<string, string>();

  files.set(
    'project.retroengine',
    `formatVersion = 2
projectId = "${projectId}"

[project]
name = "${name}"
version = "0.1.0"
engine = "${engineVersion}"

[build]
entry = "src/game.ts"
editorEntry = "src/editor.ts"

[run]
startupScene = ""
`,
  );

  files.set(
    'package.json',
    `${JSON.stringify(
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        dependencies: depMap(RETRO_DEPS, spec),
        devDependencies: { ...depMap(RETRO_DEV_DEPS, spec), typescript: '^5.7.0' },
      },
      null,
      2,
    )}\n`,
  );

  files.set(
    'tsconfig.json',
    `${JSON.stringify(
      {
        extends: '@retro-engine/tsconfig/tsconfig.json',
        include: ['src/**/*.ts', 'assets/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );

  files.set(
    'bunfig.toml',
    `[install.scopes]
"@retro-engine" = { url = "https://npm.pkg.github.com", token = "$GITHUB_TOKEN" }
`,
  );

  files.set('.gitignore', 'node_modules/\n.re/\n');

  files.set(
    '.vscode/settings.json',
    `${JSON.stringify(
      {
        'files.associations': {
          '*.rescene': 'yaml',
          '*.reprefab': 'yaml',
          '*.retroengine': 'toml',
        },
      },
      null,
      2,
    )}\n`,
  );

  files.set(
    'src/game.ts',
    `import { defineProject } from '@retro-engine/project';

export default defineProject({
  plugins: [],
  meta: { name: ${JSON.stringify(name)} },
});
`,
  );

  files.set(
    'src/editor.ts',
    `import { defineEditorExtensions } from '@retro-engine/project/editor';

export default defineEditorExtensions({
  setup() {
    // Register custom inspectors / field renderers here.
  },
});
`,
  );

  // Keep the empty content root in version control so the layout is obvious.
  files.set('assets/.gitkeep', '');

  return files;
}
