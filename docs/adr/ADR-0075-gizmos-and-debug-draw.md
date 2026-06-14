# ADR-0075: Gizmos and debug-draw

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

The studio showed live 3D viewports (ADR-0074) but had no way to draw visual helpers into them and no transform gizmos. Two needs sit behind this: a general, world-space debug-draw capability the engine (and eventually user game code) can use to render lines/shapes, and interactive Move/Rotate/Scale handles for editing transforms in the Scene viewport.

These needs share a hard constraint: some visuals must render in the Scene editor viewport but **not** in the Game view. The engine already has render layers — `RenderLayers` on cameras and entities, enforced in `check-visibility.ts` — but mesh visibility is an aggregate boolean across all active cameras, and the material phase queues do not re-filter per camera. So general meshes cannot be made "scene-only" today, and a separate, self-contained mechanism is needed for editor-only visuals.

The renderer HAL supports `line-list` topology but no immediate-mode line pipeline existed. The studio's transform model is also disconnected from the ECS (the hierarchy operates on a mock data model), and viewport picking is out of scope for this pass, so a gizmo cannot rely on a selection→entity bridge yet.

## Decision

Add an engine-level, immediate-mode, world-space `Gizmos` debug-draw API rendered through a dedicated line pass, and build editor transform gizmos on top of it in `editor-sdk`.

- **`Gizmos` buffer (engine, user-facing):** a resource accumulating line segments each frame (`line`, `lineGradient`, `ray`, `circle`, `arc`, `sphere`, `cuboid`, `arrow`, `axes`, `grid` — all decomposing to line segments). Every segment carries a render-layer mask and a depth-test flag. The buffer is packed into one growable vertex buffer and cleared after the frame's render pass — pure immediate mode, no retained handles.
- **Dedicated line pass:** a `ViewNode` inserted into **both** `Core2d` and `Core3d` that runs **last** — after the transparent pass and every post pass present (TAA, motion blur, tonemapping) — and draws into the camera's **final** target (`view.target`). Running after tonemap into the LDR output keeps handles crisp and out of both the HDR intermediate and the TAA temporal history (drawing into the post-TAA scene view would otherwise ghost them into the next frame's history). The node branches on `view.depth`: 3D draws depth-tested and always-on-top streams; 2D (no depth buffer) draws a single on-top stream. Both 2D and 3D work out of the box.
- **Scene-vs-game separation is the pass's per-view layer gate.** Each draw range is drawn only when its layer mask intersects `ctx.view.renderLayers`. A reserved `EDITOR_GIZMO_LAYER` (bit 31) carries editor-only visuals; editor cameras opt in via `RenderLayers.layers(0, EDITOR_GIZMO_LAYER)`, game cameras keep the default mask and draw nothing on it. This is the documented, scalable pattern for editor-only-vs-game visuals — new gizmo/debug types inherit it for free.
- **Transform gizmos (`editor-sdk`, editor tooling):** a `TransformGizmo` controller with Move/Rotate/Scale/All modes and 2D/3D spaces. It edits one or more targets about their shared centroid, keeps a constant on-screen size at any camera distance, shows a live drag readout (delta / angle / factor), and reverts on Escape. Handles render as 3D lines through the `Gizmos` API; the readout draws through the editor `Draw` facade. The gizmo math (`Ray`, ray-plane, ray-ray closest point, signed angle on plane, screen-space scale) lives in `packages/math` and is projection-agnostic, so it is correct under both perspective and orthographic cameras.
- **Demo binding:** because picking is out of scope, the studio binds a gizmo mode to each demo primitive with a studio-local `EditorGizmo` marker (Move / Rotate / Scale / All across four objects), rather than a selection bridge.

## Consequences

- The debug-draw foundation is exposable to user game code: a game can draw rays/bounds/shapes, and render layers let it keep debug visuals off a shipping camera. The transform-gizmo controller and its 2D readout stay editor-only.
- Editor-vs-game separation is solved for gizmos without touching the general mesh queue. The pre-existing "no per-camera mesh layer filtering" gap remains for regular meshes; closing it is separate work.
- Lines are 1px hardware `line-list` for this pass. Screen-space line width (instanced quads) is deferred and tracked in backlog; the CPU buffer, pass, plugin, and layer gate are unchanged by that upgrade.
- Multiple simultaneous gizmos (one per demo object) work because their handles are spaced apart; overlapping handles across distinct gizmos are not disambiguated. A real editor would drive a single gizmo from the active tool + selection once a selection↔ECS bridge exists (tracked in backlog).
- The gizmo render pass runs per camera every frame, but draws nothing when the buffer is empty or no range matches the camera's layers, so non-editor scenes pay one graph edge and an empty-check.

## Implementation

- `packages/math/src/ray.ts` — `Ray`, `Ray.fromScreen`, `rayPlaneIntersect`, `rayClosestPointToRay`, `signedAngleOnPlane`.
- `packages/math/src/screen-scale.ts` — `screenSpaceScale`.
- `packages/engine/src/gizmos/gizmos.ts` — `Gizmos` (immediate-mode buffer + drawing API), `GizmoDrawOptions`.
- `packages/engine/src/gizmos/gizmo-layers.ts` — `EDITOR_GIZMO_LAYER`, `EDITOR_GIZMO_MASK`, `DEFAULT_GIZMO_MASK`, `GIZMO_VERTEX_STRIDE`.
- `packages/engine/src/gizmos/gizmo-mesh.ts` — `GizmoMesh` (pipelines, packing, draw ranges), `GizmoPipelineKey`, `GizmoDrawRange`.
- `packages/engine/src/gizmos/gizmo-buffer-gpu.ts` — `GizmoBufferGpu` (growable vertex buffer).
- `packages/engine/src/gizmos/gizmo.wgsl.ts` — `GIZMO_WGSL` (`retro_engine::gizmo`).
- `packages/engine/src/gizmos/gizmo-pass-node.ts` — `makeGizmoPassNode`, `GizmoPass2dLabel`, `GizmoPass3dLabel`.
- `packages/engine/src/gizmos/gizmo-plugin.ts` — `GizmoPlugin` (auto-added by `CorePlugin`).
- `packages/editor-sdk/src/gizmo/transform-gizmo.ts` — `TransformGizmo`.
- `packages/editor-sdk/src/gizmo/{types,hit-test,drag,feedback}.ts` — controller types, screen-space hit-testing, multi-target drag math, 2D readout helpers (`dashedLine`, `labelChip`, `worldToScreen`).
- `apps/studio/src/gizmo-wiring.ts` — `EditorGizmo` marker, `SceneGizmos` driver.
- `apps/studio/src/scene-bootstrap.ts` — editor camera on the gizmo layer, fourth demo primitive, per-entity gizmo modes.
- `apps/studio/src/panels-viewport.ts`, `apps/studio/src/main.ts` — Scene panel calls the gizmo driver.
