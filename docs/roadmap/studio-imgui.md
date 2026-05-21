# Studio + jsimgui Integration

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

The studio uses [`@mori2003/jsimgui`](https://www.npmjs.com/package/@mori2003/jsimgui) as its UI toolkit, layered on the same WebGPU canvas the engine renders to. ImGui draws after the engine's main pass in the same command encoder. If the upstream package can't share a device cleanly, we fork, patch, and build via Docker.

## Phases

1. **Smoke test** — day-1 task in [`apps/studio`](../../apps/studio/): canvas + engine empty frame + jsimgui demo window.
2. **Shared device lifecycle** — engine and jsimgui both use the same `GPUDevice`. Determine where it's owned and how it's passed.
3. **Pass ordering** — engine emits its passes, then ImGui's draw call appends. Same command encoder, same submit.
4. **Docking layout** — if upstream supports it, enable; otherwise patch.
5. **Theme / styling** — pick a theme that matches the studio identity.
6. **Fallback fork** — if upstream blocks us:
   1. Clone the [jsimgui repo](https://github.com/mori2003/jsimgui) (verify URL).
   2. Patch the WASM build to expose the missing hooks.
   3. Build inside a Docker image with the right Emscripten toolchain.
   4. Publish to GitHub Packages under `@retro-engine/jsimgui` (or vendor via git+ssh).

## Open questions

- Does jsimgui currently expose a way to share an existing `GPUDevice` and `GPUTextureView`?
- Input handling: engine input system vs ImGui's IO. Need to decide ordering / consumption (ImGui claims input first when hovered).
- Hi-DPI: ImGui needs DPI scaling; same canvas size logic as engine.
- ImGui font atlas: where it lives, how it loads, how it interacts with the asset system later.

## Links

- jsimgui npm: https://www.npmjs.com/package/@mori2003/jsimgui
- ImGui upstream: https://github.com/ocornut/imgui
