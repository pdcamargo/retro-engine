# Animation Controller editor

Visual authoring for `AnimationController` assets — Retro Engine's equivalent of
Unity's Animator window — as dockable studio panels built on the existing node-graph
toolkit (`packages/graph-editor`). Fulfills the two deferred bullets under
"Animation authoring UI" in `docs/backlog/animation-authoring-and-retargeting-extensions.md`
(the controller node-graph editor and the avatar-mask authoring UI); those bullets are
removed from that backlog only when this initiative is confirmed done.

Design source of truth: the Claude Design handoff (`animation-controller/README.md` +
8 annotated screenshots + reference algorithms + the §9 acceptance checklist).

## What already exists (not rebuilt)

- **Runtime is complete** (`packages/engine/src/animation/`): parameters, states,
  transitions (any-state, AND-conditions, crossfade, exit time), recursive nested
  motions (`clip`/`blend1d`/`blend2d`, three 2D algorithms; ADR-0140), layer stacking
  (`AnimationLayers` + `layer-blend.ts`), avatar masks, and the blend-weight math
  (`weights1d`/`weights2d`) the editor reuses for previews.
- **Asset kinds are registered**: `AnimationController` (`.ranimctrl`), `AnimationClip`
  (`.ranim`), `AvatarMask` (`.ramask`); serializers exist; browser category `animation`.
- **Graph toolkit is mature and data-driven** (`packages/graph-editor`): generic
  `GraphDocument`, per-kind node registry, state/transition rendering, pan/zoom/marquee,
  undo via the shared `History`, `graph.*` MCP commands. `panels-graph-demo.ts` renders a
  reference state machine.

The gap is entirely the authoring UI.

## Decisions

- **Full scope; only live/debug is deferred** → `docs/backlog/animation-controller-live-debug.md`.
- **Controller-owned layers** → ADR-0141 (`.ranimctrl` v3; runtime `AnimationLayers`
  materialized from the authored stack).
- **Animation assets → YAML** → ADR-0142 (`.ranimctrl`/`.ranim`/`.ramask`).
- **AC editor architecture** → ADR-0143 (to be sealed after Phase 2 validates it):
  domain object is source of truth; a derived `GraphDocument` per navigated view is the
  interaction/render surface via a codec; graph layout persists in the `.meta` sidecar
  `data` body (JSON); rich per-selection editing lives in the shared Inspector via a new
  `animatorSelection` channel; a new `animController.*` MCP command domain.

## Phases

- **Phase 1 — data model** _(done)_: `layers` on the controller, `.ranimctrl` v3, JSON→YAML
  for the three animation assets, runtime materialization (`driveStack`), round-trip +
  migration tests. ADR-0141, ADR-0142.
- **Phase 2 — editor foundation + create/open** _(done)_: `apps/studio/src/animator/` (AC
  graph kind, `controller↔GraphDocument` codec, Animator panel: sidebar + breadcrumb +
  canvas); create-on-disk (empty-space "New Animation Controller" menu → `createAsset` +
  reindex + open) + double-click open routing + save (`ac-asset.ts`). _Layout→sidecar and
  inline rename-in-place card remain (see Remaining)._ ADR-0143 still to seal.
- **Phase 3 — states + parameters + transitions** _(done)_: sidebar params (CRUD + retype
  + defaults), states (CRUD, speed, default/entry, Any-State), transitions (create/delete
  incl. any-state, T/E/· badges), and the state/transition/parameter Inspector bodies via
  the shared Inspector (`animatorSelection` channel). `ac-ops.ts` (unit-tested).
- **Phase 4 — blend trees** _(done)_: 1D/2D/nested motion editing; blend-tree canvas (root
  with per-child output pins — needed a toolkit change: per-instance `GraphNode.inputs/
  outputs` — wired to child nodes); breadcrumb descent/back; blend-tree Inspector (blend
  type/param combos, editable motion table with preview weights, + Clip / + Sub-tree,
  descend). _2D blend-space draggable-sample preview remains (see Remaining)._
- **Phase 5 — layers + masks** _(done)_: Layers tab (add + select + base row, weight bar,
  Over/Add badge, mask glyph), layer Inspector (weight/blend/mask/source), avatar-mask
  editor (bone toggles from scene `AnimationTarget`s, All/None, create/save `.ramask`).
  _Reorder grips, indented bone tree + Upper/Lower presets, existing-mask picker remain._
- **Phase 6 — MCP + polish** _(partial)_: gate chain green (lint/typecheck/test/build/
  bench) + changeset. `animController.*` MCP commands → deferred
  (`docs/backlog/animation-controller-mcp-commands.md`).

## Remaining / deferred

- **`animController.*` MCP commands** → `docs/backlog/animation-controller-mcp-commands.md`.
- **Live/debug view** → `docs/backlog/animation-controller-live-debug.md`.
- **Polish (tracked here)**: 2D blend-space draggable-sample preview; layout persistence to
  the `.meta` sidecar (currently auto-layout on open); inline rename-in-place asset card;
  layer reorder grips; indented mask bone tree + Upper/Lower presets + existing-mask picker;
  clip pickers for state/blend-child/layer clip references (currently show the ref, assigned
  by drop later); bowed bidirectional transition pairs. Seal ADR-0143 once the architecture
  is confirmed.
