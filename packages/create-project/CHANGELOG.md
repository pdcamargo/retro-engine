# @retro-engine/create-project

## 0.1.0

### Minor Changes

- 25376d8: feat(create-project): scaffold `@retro-engine/runtime-web` as a project dependency

  The web export bundles from the project tree, and its generated boot entry
  imports `@retro-engine/runtime-web` (`bootWebGame`). New projects now list it as
  a dependency so `retro build --target web` (and the studio "Build → Web" menu)
  resolve it out of the box.

- 5451d30: feat(project): project entry-point contract + scaffolder (standalone studio, phase 0)

  Three new packages that define what a Retro Engine game project _is_, ahead of the studio
  learning to open one:

  - `@retro-engine/project` — `defineProject({ plugins, meta })` (game-runtime entry,
    `src/game.ts`) and `defineEditorExtensions({ setup })` (optional studio-only entry,
    `@retro-engine/project/editor`). Identity helpers that fix a single, discoverable
    entry-point convention and keep editor-only code out of game builds.
  - `@retro-engine/tsconfig` — shared TypeScript base a project extends, matching the
    engine's own compiler settings so types resolve identically.
  - `@retro-engine/create-project` — scaffolds a project (`project.retroengine` descriptor +
    Bun/TS skeleton + `src/game.ts`/`src/editor.ts` + free-form `assets/` content root) and
    runs the first `bun install`, which materializes `node_modules` so any IDE gets full
    IntelliSense for `@retro-engine/*` with no extra tooling.
