# ADR-0147: Audio architecture (HAL + Web Audio backend)

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

The engine has no audio. To ship a game it needs playback of sound effects and
music, driven from ECS, working the same in the browser and inside the Tauri
webview. Both targets expose the **Web Audio API** (`AudioContext`); there is no
second realistic web/webview audio backend (unlike the renderer's WebGPU/WebGL2
or physics' rapier2d/3d). Constraints:

- **Autoplay policy** — a fresh `AudioContext` starts *suspended* and only
  produces sound after `resume()` is called from a user gesture. This is
  universal across modern browsers.
- **One-shot source nodes** — an `AudioBufferSourceNode` plays once; replaying a
  sound requires a *new* node each time. Volume is a `GainNode`, pitch is
  `playbackRate`, looping is the `loop` flag.
- **Decoding needs a context** — `AudioContext.decodeAudioData` turns encoded
  bytes into an `AudioBuffer`, and it *detaches* the input `ArrayBuffer`.
- **Headless** — tests and server worlds have no `AudioContext`; audio must be a
  no-op there, and asset *loading* must not depend on a context.
- The asset system already gives us a kind registry, `.meta` sidecars, GUID
  loading, and per-extension/‑kind loaders (ADR-0055/0056/0089/0111).

## Decision

Audio ships as a single **`packages/audio`** package (`@retro-engine/audio`),
layered on `@retro-engine/engine` like `@retro-engine/input` — the engine does
**not** depend on it (no startup dependency-injection need), so a HAL split into
`-core`/`-web` packages buys nothing. The seam is an interface *within* the
package, matching `InputBackend`:

- **`AudioBackend`** interface — `resume()` / `suspended()`,
  `play(clip, options): VoiceId | null`, `stop(voice)` / `stopAll()`,
  `setVolume(voice, v)` / `isPlaying(voice)`, `setMasterVolume(v)` /
  `masterVolume()`, `destroy()`. A `VoiceId` is an opaque handle to one playing
  instance; `PlayOptions` is `{ volume?, loop?, pitch? }`.
- **`WebAudioBackend`** — owns an `AudioContext` and a master `GainNode →
  destination`. Decodes each `AudioClip` **lazily on first play** and caches the
  `AudioBuffer` (decode copies the bytes so the clip's data survives detach). Each
  `play` builds a fresh `AudioBufferSourceNode → GainNode → master`; one-shots
  self-free on `ended`, loops play until `stop`. Attaches a one-time
  `pointerdown`/`keydown` listener that calls `resume()`, so the autoplay policy
  is handled without host wiring.
- **`NullAudioBackend`** — no-op for headless; every `play` returns `null`.
- **`AudioClip`** — an asset holding the **encoded** bytes (`.wav`/`.ogg`/`.mp3`),
  not a decoded buffer. Decoding is the backend's job, so the asset is
  backend-independent and loads fine headless (only *playback* needs a context).
  Registered as a discoverable, `largeBinary` asset kind with a loader on all
  three extensions; no serializer (source files are imported, not authored).
- **`Audio`** resource — the ECS-facing facade over the active backend
  (`play` / `stop` / `stopAll` / `setMasterVolume` / `resume`). `AudioPlugin`
  selects `WebAudioBackend` when an `AudioContext` is available, else
  `NullAudioBackend`, inserts `Audio`, registers the `AudioClip` kind/store/loader,
  and is opt-in (not in `CorePlugin`) and headless-safe — mirroring `InputPlugin`.

This is **Phase 1**. The ECS components (`AudioSource` / `AudioListener`, with
reflection schemas per §13) and the systems that drive playback from entity state
are **Phase 2**; mixer buses are **Phase 3 (P1)**.

## Consequences

- Game code plays audio through one resource with no Web Audio knowledge; tests
  and headless worlds get the null backend for free.
- Storing encoded bytes (not decoded buffers) keeps `AudioClip` loadable without a
  context and defers the cost of decode to first play; the trade-off is a small
  first-play latency per clip (mitigated by the decode cache).
- A single package (interface + backends co-located) is simpler than a two-package
  split and consistent with `input`; if a native (non-Web-Audio) backend is ever
  needed, it conforms to `AudioBackend` without a package move.
- The autoplay policy is handled inside the backend, so neither the studio nor a
  game must thread a "user gesture" promise through — at the cost of the first
  sound before any interaction being silently dropped (expected browser behavior).
- No per-frame hot path exists in Phase 1 (playback is event-driven), so no bench
  yet; Phase 2's `AudioSource`→voice reconciliation is pure and will carry one.

## Implementation

- `packages/audio/src/audio-clip.ts` — `AudioClip`, `AUDIO_CLIP_ASSET_KIND`,
  `createAudioClipImporter`.
- `packages/audio/src/audio-backend.ts` — `AudioBackend`, `VoiceId`, `PlayOptions`.
- `packages/audio/src/web-audio-backend.ts` — `WebAudioBackend`.
- `packages/audio/src/null-audio-backend.ts` — `NullAudioBackend`.
- `packages/audio/src/audio-resource.ts` — `Audio`.
- `packages/audio/src/audio-plugin.ts` — `AudioPlugin`.
