---
'@retro-engine/create-project': minor
'@retro-engine/tsconfig': minor
'@retro-engine/project': minor
---

feat(project): project entry-point contract + scaffolder (standalone studio, phase 0)

Three new packages that define what a Retro Engine game project *is*, ahead of the studio
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
