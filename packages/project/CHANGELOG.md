# @retro-engine/project

## 1.0.0

### Minor Changes

- c867984: feat(project): `isEditorHint()` + `runInEditor()` for tool systems (ADR-0098)

  Run user code in the editor while the game isn't playing — Godot `@tool` / Unity
  `[ExecuteAlways]` for Retro Engine:

  - `isEditorHint()` — true inside the studio (Edit or Play), false in a standalone
    runtime. Branch editor-only behavior (preview/gizmos) vs game logic.
  - `runInEditor(systemFn)` — tags a system so the studio's play-state gate skips it; it
    runs in Edit as well as Play. Returns the same function for inline use. Inert (no-op)
    in a standalone runtime, so the same code runs in both.
  - `isRunInEditor(fn)` — host-side predicate the studio reads; not needed by game code.

  The engine stays editor-agnostic: the hint is a global the studio sets, the tag is a
  project-package symbol.

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

- a2b79eb: feat(build): web runtime host (`bootWebGame`) + `retro build` CLI (web export phase 3)

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

### Patch Changes

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [6ce8fae]
- Updated dependencies [7d40c1a]
- Updated dependencies [952766f]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [d4b6766]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [01e2615]
- Updated dependencies [0baa8a9]
- Updated dependencies [7142f6f]
- Updated dependencies [2c27d90]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [2c27d90]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [2324f9f]
- Updated dependencies [294c161]
- Updated dependencies [597b913]
- Updated dependencies [6e1d04c]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [03688a4]
- Updated dependencies [9e2aaf5]
- Updated dependencies [dc943f5]
- Updated dependencies [77f0ed5]
- Updated dependencies [2abd75c]
- Updated dependencies [0408a70]
- Updated dependencies [3df2cb6]
- Updated dependencies [0625db9]
- Updated dependencies [4c93e0b]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [9d41f83]
- Updated dependencies [056bfc9]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4741039]
- Updated dependencies [4ca7beb]
- Updated dependencies [0bc6ca5]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [5599db7]
- Updated dependencies [5988cb6]
- Updated dependencies [a055d25]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [c2732c5]
- Updated dependencies [fad8a5e]
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [391b3c2]
- Updated dependencies [7a1d32c]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [0eca147]
- Updated dependencies [88d0fc5]
- Updated dependencies [45af863]
- Updated dependencies [ecfc0e3]
- Updated dependencies [056bfc9]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [68ce298]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [9d37161]
- Updated dependencies [62effe1]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [75a1a8a]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [1b98dc4]
- Updated dependencies [056bfc9]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [ae68f06]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [824b04f]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [f0584f2]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [59d37c2]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [f55bffb]
- Updated dependencies [b1a1e01]
- Updated dependencies [5b52805]
- Updated dependencies [dd3de07]
- Updated dependencies [d8c0bda]
- Updated dependencies [b10dc50]
- Updated dependencies [05d2bb6]
- Updated dependencies [0f8701d]
- Updated dependencies [7f40ed1]
- Updated dependencies [591fdef]
- Updated dependencies [42d7275]
- Updated dependencies [b2a610d]
- Updated dependencies [2beee52]
- Updated dependencies [05b372f]
- Updated dependencies [5cf81f9]
- Updated dependencies [ce20898]
- Updated dependencies [823e5cd]
  - @retro-engine/engine@0.1.0
  - @retro-engine/editor-sdk@0.1.0
