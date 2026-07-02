# Animation Controller — `animController.*` MCP commands

Deferred from the Animation Controller editor initiative
(`docs/roadmap/animation-controller-editor.md`). Per CLAUDE.md §14, every editor-facing
capability gets a `defineCommand(...)` so AI agents drive it through typed tools. The
Animator's authoring capabilities (create controller; param/state/transition/motion/
layer/mask edits; save) are currently driven only through the studio UI, not MCP.

## Why not done in the first pass

The AC edit logic is deliberately factored into studio-local modules that are already
MCP-shaped:

- `apps/studio/src/animator/ac-ops.ts` — pure controller mutations (add/rename/delete/
  retype params; state CRUD + speed + default; transitions + conditions + timing; blend-
  tree children + thresholds/positions/params/mode; layer CRUD + fields + mask/source).
- `apps/studio/src/animator/ac-asset.ts` — create/open/save on disk + mask create/save.

The blocker is wiring: `CommandContext` (`packages/editor-mcp/src/context.ts`) exposes
`app` / `history` / `assetServer` / `reindexAssets` but **not the `AnimatorSession`**, and
`ac-ops` lives in the studio (editor-mcp cannot import it). So the commands can't reach the
open controller or the edit ops from where `defineCommand` runs.

## The work

- Add an `AnimatorSession`-shaped accessor to `CommandContext` (an interface editor-mcp
  owns; the studio provides the live session at `attach()`), mirroring how `capture` /
  `composer` are optional studio-provided capabilities.
- Move the pure edit surface (`ac-ops`) to a package editor-mcp can import (e.g. a small
  `@retro-engine/anim-authoring`, or fold the ops into `packages/engine` since they are
  pure controller transforms), leaving the studio modules as thin re-exports.
- Define `animController.*` in `packages/editor-mcp/src/commands/anim-controller.ts`
  wrapping those ops + `ac-asset` create/open/save, routed through `ctx.history` + the
  audit ring (like `graph.*` / `component.*`): `create`, `param.{add,rename,retype,
  setDefault,delete}`, `state.{add,rename,delete,setSpeed,setDefault,setMotionKind}`,
  `motion.{addChild,removeChild,setThreshold,setPos,setParam,setMode}`, `transition.
  {create,delete,addCondition,setCondition,deleteCondition,setTiming}`, `layer.{add,
  remove,move,setField,setSource,setMask}`, `mask.{create,setBone}`, `save`.
- Register in `packages/editor-mcp/src/commands/index.ts` (`defaultCommands`).

The commands are thin — the ops are done and unit-tested; this is the transport layer.
