# Reference — Feature Map ("second brain")

A curated, honest map of **what Retro Engine actually does today** — and how finished each piece
is. This folder is the answer to "does the engine already have X, and can I rely on it?"

It is deliberately different from the other `docs/` folders:

| Folder | Answers |
|---|---|
| `adr/` | *Why* a thing was built the way it is (locked decisions). |
| `roadmap/` | *What we intend to build next* (living initiatives). |
| `backlog/` | *Discrete deferred work* (one task each). |
| `bugs/` | *Known-broken* (one bug each). |
| **`reference/`** (this folder) | ***What exists right now, and its maturity.*** |

## Status legend

Every subsystem carries one tag:

- ✅ **done** — implemented and relied upon; the normal path works.
- 🟡 **partial** — works, but with named gaps or only a subset of the obvious feature.
- 🔩 **stub** — a placeholder/contract with no real behavior behind it.
- ❌ **absent** — does not exist yet.

Tags describe the *engine*, not any single file. A subsystem can be ✅ while a specific corner of it
is 🟡 — those corners are called out inline.

## Files

- [`engine-core.md`](engine-core.md) — ECS, App/plugins/schedules/states, transforms & hierarchy,
  time, reflection, scenes/prefabs/bundles; the absent runtime pillars (input, audio, windowing,
  physics) and the planned physics-package architecture.
- [`renderer.md`](renderer.md) — HAL + capability flags, WebGPU backend, WebGL2 stub, render graph,
  materials (PBR/2D), meshes, images, cameras, 2D+3D lighting & shadows, IBL/skybox, post-FX,
  instancing/culling; the WebGPU-in-webview constraint.
- [`animation.md`](animation.md) — clips/players, controller state machine, blend trees, layers &
  masks, IK, retargeting, GPU skinning, morph targets, RetroHuman.
- [`assets.md`](assets.md) — asset store/handles, asset server, kind registry, `.meta` sidecars,
  GUIDs, hot reload, glTF import, on-disk formats.
- [`studio-editor.md`](studio-editor.md) — panel/docking shell, viewport, gizmos/picking/camera,
  hierarchy, inspector, asset browser, history, prefab authoring, animator, graph-editor toolkit,
  MCP surface, standalone project system.

## How this stays true

- **Update on landing.** When a roadmap/backlog item ships, flip the relevant tag here in the same
  change. A ✅ that has rotted is worse than no map.
- **`file:line` pointers are hints, not contracts.** They will drift; treat them as "start looking
  here," and trust the described behavior over the exact line.
- **The forward-looking counterpart is [`../roadmap/MASTER-ROADMAP.md`](../roadmap/MASTER-ROADMAP.md)** —
  the single prioritized checklist. Everything tagged 🔩/❌/🟡 here should have a home there.

ADR numbers are referenced freely below (this folder is docs, not shipped `packages/*/src`, so the
CLAUDE.md §4 in-source prohibition does not apply). To find the ADR governing a symbol, grep `../adr/`.
