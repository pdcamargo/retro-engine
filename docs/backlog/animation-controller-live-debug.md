# Animation Controller editor — live / debug view

Deferred from the Animation Controller editor initiative
(`docs/roadmap/animation-controller-editor.md`). The authoring editor ships first;
this is the "reflect the running machine" half of the handoff (§6, §8, and the live
rows of the §9 checklist). It is ~a third of the handoff's value but depends on a new
runtime→editor feed that does not exist today (the studio has only
`studio_play`/`pause`/`stop`).

## What it is

When the game runs in the studio, the Animator + Inspector reflect runtime state
(pure view — never mutates the running world):

- **Active state** glows phosphor (ring + halo) in the state graph.
- **Parameters** list shows **live values in magenta** (floats update; triggers flash
  on fire).
- **In-flight transition** animates: marching "flow" dash on the wire + a **magenta
  crossfade-progress ring** (0→100%) on the midpoint badge.
- **Blend trees** show **live per-clip weights** (root output rows + child nodes glow ∝
  weight; the Inspector weight column updates) and the **2D sample point** moves
  (magenta) with the live params.
- **Color rule**: magenta appears **iff** the machine is live; amber stays selection;
  phosphor stays active/entry.
- Respects `prefers-reduced-motion` (freeze on a representative frame; no marching dash).

## What it needs (the deferred work)

- **A runtime→editor live feed** — push-based from the running world, shaped roughly as
  the handoff's `LiveState`: `{ activeState, params, weights (per motion node),
  sample2d?, transition? { id, progress } }`. Source data exists at runtime
  (`ControllerRuntime` in `state-machine.ts`, `evaluateMotion` weights, the layer/
  controller player); the missing piece is exposing it to the editor while playing. Decide
  the transport (a studio-side bridge reading the running world each frame, vs an MCP
  push channel) and the per-frame cost/throttling.
- **A stable domain↔node id mapping** so live values map onto the derived `GraphDocument`
  nodes/edges (each editor node already carries its source domain identity per ADR-0143).
- **The magenta live overlays** on the graph canvas, parameter rows, transition badges,
  and the blend-space preview, gated on live state + `prefers-reduced-motion`.

## Why deferred

Authoring is the foundation and stands alone (edit-mode preview via the draggable sample
point still ships). The live feed is new runtime plumbing best designed once the
authoring data model and the domain↔node mapping are settled, not up front.
