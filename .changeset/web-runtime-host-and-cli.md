---
'@retro-engine/runtime-web': minor
'@retro-engine/build': minor
'@retro-engine/project': minor
---

feat(build): web runtime host (`bootWebGame`) + `retro build` CLI (web export phase 3)

Closes the gap between a bundled project and a running game, and gives the web
export a command-line entry point. A real asset-free project now exports and
runs in a browser end-to-end.

**New `@retro-engine/runtime-web`** — the browser runtime host (ADR-0153):

- `bootWebGame(definition, options?)` resolves the render canvas, creates a
  renderer backend (WebGPU by default, injectable), constructs the `App`, adds
  every project plugin in order, and starts the frame loop. The shipped-game
  counterpart to the studio's editor host.
- `resolveCanvas(target, doc?)` — resolves an `HTMLCanvasElement` or element id.

**`@retro-engine/build`:**

- `emitWebBoot(options)` — emits the boot-entry source that hands a project's
  `ProjectDefinition` to `bootWebGame`. `WebExportTarget` now bundles this
  generated entry (engine + backend inlined) so the produced `main.js` actually
  boots the game, keeping the user's `src/game.ts` a pure declaration.
- `runWebExport(options)` + a `retro-build` CLI (`retro build --target web`):
  reads `project.retroengine`, resolves the build entry, and writes a static
  site to `<project>/dist/web`.
- Production bundling keeps `identifiers: false` so component constructor names
  survive minification for reflection-based scene serialization.

**`@retro-engine/project`:**

- `parseProjectDescriptor(toml)` / `ProjectDescriptor` — the shared parser for
  the `project.retroengine` manifest (entry, startup scene, metadata).

Verified end-to-end: an asset-free sample project (`@retro-engine/sample-game`)
exports via the CLI, and the produced static site boots in a real browser —
WebGPU initializes, the engine renders MSDF text, and the frame loop animates a
spinning label. The studio "Build → Web" menu and packing `assets/` into the
`.rpak` remain.
