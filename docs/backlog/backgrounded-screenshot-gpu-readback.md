# Backgrounded screenshots via GPU readback

The MCP `screenshot.editor` / `screenshot.panel` commands capture the studio via
`canvas.toDataURL()`. That reads the *composited* canvas image, which the OS/WebKit
freezes for an occluded (hidden) window — so screenshots taken while the studio is
backgrounded (the normal case: the user is in their terminal driving Claude) return
a **stale** frame.

## Findings (verified live, macOS 26 / Tauri 2.11)

- An occluded Tauri window reports `document.visibilityState === "hidden"`, which by
  the Page Visibility spec **pauses `requestAnimationFrame`** and throttles timers —
  independent of `backgroundThrottling`.
- `app.windows[].backgroundThrottling: "disabled"` (now set in `tauri.conf.json`)
  only prevents the eventual full *suspend* (~5-min page unload). It does **not**
  restore rAF, full-rate timers, or compositing for a hidden window. Measured while
  hidden: rAF never fired; `setInterval(16ms)` ran at ~10 Hz.
- `App.advanceFrame()` (engine) renders a frame **synchronously on demand** and works
  while backgrounded — the only broken link is *reading the pixels back* via the
  compositor-gated `toDataURL`.

## The work

Add a GPU-readback path so capture does not depend on canvas compositing:

- `renderer-webgpu`: a `readColorTarget()` (or similar) that `copyTextureToBuffer`s
  the final rendered color texture and returns RGBA bytes. The canvas context (or an
  owned final target) must be configured with `GPUTextureUsage.COPY_SRC`; if the
  swapchain texture can't carry `COPY_SRC`, render the final image into an owned
  texture and blit to the canvas, then read the owned texture.
- Wire it through `renderer-core` capability/HAL so it stays WebGL2-reachable
  (gl.readPixels is the WebGL2 equivalent).
- `apps/studio/src/screenshot.ts`: after `advanceFrame()`, read pixels via the new
  readback instead of `toDataURL`, then encode PNG (and still crop per-panel by rect).
- Keep the existing `toDataURL` path as a fast path when the window is visible if
  worthwhile, or replace it outright.

Lands as an ADR (touches the render path / a new HAL capability).

## Out of scope

- Keeping the *engine loop* running full-rate while backgrounded — web caps this
  (rAF paused, timers ~10 Hz). A `setInterval`-driven background loop (≤10 Hz) is a
  separate, optional initiative; for a game, pausing when hidden is usually correct.

## Until then

Screenshots work correctly when the studio window is **visible**. The non-intrusive
capture (focus target tab → crop → restore prior tab) and on-demand `advanceFrame`
stepping are already in place.
