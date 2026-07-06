# ADR-0153: Web runtime host (`bootWebGame`) and the generated boot entry

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

ADR-0151 defined the web export target: `WebExportTarget` bundles a project's
user code, emits `index.html`, and packs assets into a `.rpak`. But a project's
entry module (`src/game.ts`) default-exports a `ProjectDefinition`
(`{ plugins, meta }` — ADR-0090 family) — it does **not** create or run an `App`.
Inside the studio, the editor host owns that step: it builds the `App`, injects
the renderer backend, adds the project's plugins, and runs the loop. A
web-exported artifact has no such host, so the bundle produced today loads but
nothing boots.

Something must turn a `ProjectDefinition` into a running browser `App`:

- Resolve the game canvas from the generated `index.html`.
- Create a renderer backend (WebGPU today; WebGL2 once it exists — ADR-0003).
- Construct the `App`, add the project's plugins in order, and `run()`.

This is the standard renderer-injection composition point (ADR-0001 §5.3), the
same shape the playground and studio already use. It must live where a backend
dependency is allowed — **not** in `engine` (which never imports a backend) and
**not** in `build` (Bun/Node-only; the host runs in the browser).

## Decision

Add **`@retro-engine/runtime-web`**: a browser runtime host that composes a
`ProjectDefinition` + a renderer backend into a running `App`. Its public entry
is `bootWebGame(definition, options?)`:

- Resolves the canvas (`options.canvas` as an element or element-id string,
  default id `'game'`) via a pure, unit-testable `resolveCanvas`.
- Creates the renderer through an injectable `options.createRenderer`
  (default `createWebGPURenderer` from `@retro-engine/renderer-webgpu`), so the
  backend is a swap point, not a hard dependency of the boot logic.
- Constructs `new App({ renderer, canvas, clearColor })`, adds every
  `definition.plugins` entry in order, and — unless `options.autoRun === false`
  — calls `app.run()`. Returns the `App` so a host (or test) can drive it.

The package depends on `@retro-engine/engine`, `@retro-engine/renderer-webgpu`,
and `@retro-engine/project`. Backend selection stays behind the injectable
factory, so WebGL2 (and startup feature-detection between the two) is additive
later without touching consumers.

The export bundles a **generated boot entry**, not the user entry directly.
`@retro-engine/build` gains `emitWebBoot({ userEntry, canvasId?, clearColor? })`,
a pure string emitter that produces a tiny ESM module importing the user's
`ProjectDefinition` and calling `bootWebGame`. `WebExportTarget` writes this entry
to a temp file and bundles **that** (resolving the user entry + `runtime-web` +
engine + backend into one self-contained `main.js`). `index.html` loads the
generated `main.js`, which now actually boots the game.

`.rpak` asset delivery into the runtime `AssetServer` is a follow-up slice; a
project with no packed assets (or one that loads them itself) boots today.

## Consequences

- A web-exported artifact runs: `retro build --target web` produces a static
  site that boots the engine and the project's plugins in a browser.
- The backend stays injected. `runtime-web` is a composition point like the
  playground/studio, so importing `renderer-webgpu` there does not violate the
  engine's backend independence (ADR-0001 §5.3).
- Bundling a generated boot entry keeps the user's `src/game.ts` a pure
  declaration (no boot boilerplate the author must write) and keeps `build`
  browser-free (it only emits a source string; the browser code is the deps the
  entry pulls in).
- The self-contained bundle inlines the whole engine + backend. Acceptable for a
  first runnable artifact; code-splitting / engine-as-shared-chunk is a later
  optimization (ADR-0151 open question).
- WebGPU-only until the WebGL2 backend lands: an exported game needs a WebGPU
  adapter to run. The injectable factory is where the future feature-detect
  (WebGPU → WebGL2 → helpful error) hangs, so this is a sequencing gate, not a
  design ceiling (CLAUDE.md §12).

## Implementation

- `packages/runtime-web/src/index.ts` — `bootWebGame`, `BootWebGameOptions`.
- `packages/runtime-web/src/boot.ts` — `bootWebGame` implementation.
- `packages/runtime-web/src/resolve-canvas.ts` — `resolveCanvas` (pure).
- `packages/build/src/web-boot.ts` — `emitWebBoot` (pure string emitter).
- `packages/build/src/web-export-target.ts` — `WebExportTarget` (bundles the generated boot entry).
- `packages/build/src/cli.ts` — `retro-build` CLI (reads `project.retroengine`, runs the web target).
- `packages/project/src/descriptor.ts` — `ProjectDescriptor`, `parseProjectDescriptor`.
