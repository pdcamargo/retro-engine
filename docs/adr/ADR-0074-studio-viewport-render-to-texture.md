# ADR-0074: Studio viewport render-to-texture

- **Status:** Accepted
- **Date:** 2026-06-14

## Context

The studio's Scene and Game tabs drew placeholder 2D ImGui geometry — they never showed engine output, even though the studio already runs the engine `App` on the shared canvas with the ImGui overlay compositing on top (ADR-0072). We need live 3D engine renders inside those docked tabs: two of them, independently sized, eventually an editor (edit) view and a game (play) view.

The engine renders cameras through a render graph. A `Camera`'s `target` is a tagged union (`primary` | `surface` | `texture` | `view`); the camera plugin re-reads `target` and calls `texture.createView()` every frame. The ImGui overlay composites onto the swapchain with `loadOp: 'load'`, so it preserves whatever was drawn to the swapchain before it — it does not clear. jsimgui's WebGPU backend can display a `GPUTexture` via `ImGuiImplWeb.RegisterTexture(tex) → ImTextureRef` + `ImGui.Image(ref, size)`.

Two composition options existed: (a) render the scene to the swapchain and show it through ImGui's transparent passthrough dock node, or (b) render each camera into an offscreen texture and draw that texture inside the panel. Option (a) yields a single fullscreen region that can't serve two independently-sized tabs and ignores panel aspect.

## Decision

The studio renders each editor viewport into its own offscreen color texture and displays it inside the owning ImGui panel via `ImGui.Image`.

- One render-target object per viewport (Scene = editor camera, Game = game camera), each owning a HAL `Texture` (preferred surface format, `RENDER_ATTACHMENT | TEXTURE_BINDING`) and a jsimgui `ImTextureRef`. The texture is reallocated to match the panel's content region; on reallocation the camera's `target` is swapped to the new texture by an `update`-stage system, taking effect the next frame.
- Cameras render to their textures every frame regardless of play state. Play will later gate the *simulation* schedule, never these renders — the Game tab is a live preview when stopped.
- A low-order (`order: -100`) primary `Camera2d` clears the swapchain each frame. With only offscreen cameras present the engine's no-camera fallback clear is skipped, so without this pass the swapchain is uninitialized behind the ImGui overlay's `load` composite.
- The raw `GPUTexture` is obtained through `renderer-webgpu`'s `GPU_TEXTURE` symbol (now exported additively) to hand to jsimgui. The studio calls `ImGui.Image` directly rather than adding an image primitive to the shipped `editor-sdk` UI surface — this is studio-specific composition.
- Each panel also records its visibility and panel-local cursor on the viewport object each frame, for a future viewport ray-pick. Nothing consumes them yet.

## Consequences

- Scene and Game are genuinely independent views — resizable, splittable, separately framed — which is the shape the edit/play end-state needs.
- The studio reaches a `GPUTexture` through an internal-but-exported symbol. `GPU*` types still never appear on the public HAL surface; the export is a deliberate seam for a host that drives an external GPU library.
- jsimgui has no texture-unregister API, so a panel resize registers a fresh `ImTextureRef` and the prior one is not freed on the JS side (the GPU texture itself is destroyed). For editor use this is acceptable; debouncing resize or an upstream unregister is a future refinement.
- The clear-only primary camera is a small cost that keeps the swapchain well-defined without editing the shipped overlay.
- Panel `contentAvail` is treated as physical pixels (the overlay runs against the DPR-scaled canvas); if a future ImGui config changes that, viewport sizing must account for `DisplayFramebufferScale`.

## Implementation

- `packages/renderer-webgpu/src/index.ts` — exports `GPU_TEXTURE`, `GPU_VIEW`, `InternalTexture`, `InternalTextureView`.
- `apps/studio/src/viewport.ts` — `ViewportTarget` (offscreen texture + `ImTextureRef` lifecycle, `ensureSize`, `consumeResized`, `visibleThisFrame`, `localMouse`).
- `apps/studio/src/scene-bootstrap.ts` — `setupViewportScene`: registers `PrepassPlugin` / `StandardMaterialPlugin` / `MaterialPlugin(StandardMaterial)` / `Light3dPlugin`, inserts `AmbientLight`, spawns the demo scene (ground + primitives + directional sun with cascaded shadows), the editor + game cameras (`hdr` + `DepthPrepass` + `MotionVectorPrepass` + `Taa`) targeting the viewport textures, the clear-only primary `Camera2d`, and a redirect system that re-points a resized viewport's camera by matching the texture it holds (no per-camera marker required). A studio-local `EditorCameraTag` marks the editor's own camera as non-scene infrastructure (for future hierarchy/serialization exclusion); the user-authored game camera carries no marker.
- `apps/studio/src/panels-viewport.ts` — `scenePanel` / `gamePanel` draw their viewport via `ImGui.Image` and overlay status chrome.
- `apps/studio/src/main.ts` — constructs the two `ViewportTarget`s and calls `setupViewportScene`.
