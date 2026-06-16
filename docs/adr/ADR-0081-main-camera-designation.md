# ADR-0081: Main camera designation marker

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

The studio's game camera was spawned imperatively in `scene-bootstrap.ts`, while
everything else in the showcase is authored as `SceneData` and loaded through
`spawnScene` (ADR-0080). To make the game camera authored content — round-tripping
like any saved entity — and let the editor redirect its output into the Game tab's
offscreen texture, we need a stable way to identify *which* authored camera is the
primary game view, independent of its name or render order.

A camera's render target does not survive serialization as a place: `target` and
`depthTarget` register only their data arms, so the texture/surface arms (live GPU
references with no persistent identity) round-trip back to `primary` (ADR-0020's
camera model). An authored camera therefore loads as "render to screen" — the
correct build-time meaning — and *something* must re-point it at the Game tab at
runtime. That something needs to find the right camera.

This is not an editor-only concern. The engine targets the browser and desktop; a
shipped game also has a principal camera — the one rendering to screen — and
gameplay code (follow-cam, screen→world picking, post-processing toggles) wants to
locate it. So the designation is a general runtime concept.

## Decision

- Introduce **`MainCamera`**, a pure marker component in `@retro-engine/engine`,
  reflection-registered by the camera plugin as `{ name: 'MainCamera' }` so it
  round-trips in any saved scene.
- `MainCamera` **designates** the principal game camera. The engine's render loop
  does not consume it — which camera draws where stays governed by `Camera.target`,
  `Camera.order`, and `Camera.isActive`. The marker exists so tooling and gameplay
  code locate the principal camera by a stable query rather than by name or render
  order. A scene carries at most one.
- Chosen over the alternatives. A **highest-`order`** convention is implicit and
  fragile (ties are ambiguous; a stray high-order overlay camera silently becomes
  "main"). A **`Name`-string** convention ("Main Camera") couples presentation to
  semantics, is typo-prone, and queries entities by name — an anti-pattern in an
  ECS. A marker component is the idiomatic Bevy approach and mirrors Unity's
  `MainCamera` tag / `Camera.main`.
- Placed **engine-side**, not studio-side. The primary-view camera is a general
  runtime concept, so an engine-owned, reflection-registered marker gives one
  canonical convention shared by the engine, the studio, and shipped games, and
  keeps the round-trip covered by the engine's own type registry rather than a
  host's.

## Consequences

- The studio authors its Main Camera into the showcase `SceneData` (transient world
  + `serializeWorld`, spliced under the showcase root) and redirects it into the
  Game tab each frame; the imperative game-camera spawn is gone. The hierarchy now
  shows "Main Camera" as authored content, not editor infrastructure.
- **Absence policy.** The engine never *requires* the marker: a standalone build
  without it renders normally (every active camera draws to its `target`), and the
  marker is inert metadata — a missing one is like Unity's `Camera.main` returning
  null, not a failure. The **studio** guarantees one for its Game tab: explicit
  `MainCamera` wins; if a loaded scene carries none, the editor promotes the
  highest-`order` **non-`EditorOnly`** camera by inserting the marker. `EditorOnly`
  is the infra-vs-content boundary, so promotion can never land on the Scene-tab or
  clear camera — only on authored game content. The engine itself does not
  auto-promote.
- The engine ships a public symbol its own render loop does not read. This is
  deliberate — `MainCamera` is a designation for consumers, documented as such on
  the type.
- Two `MainCamera`s in one scene is an author error the editor does not dedupe; the
  redirect would point both at the Game tab. The ≤1 convention is documented, not
  enforced.

## Implementation

- `packages/engine/src/camera/main-camera.ts` — `MainCamera`
- `packages/engine/src/camera/camera-plugin.ts` — `MainCamera` reflection registration (`name: 'MainCamera'`)
- `packages/engine/src/index.ts` — re-exports `MainCamera`
- `apps/studio/src/showcase-scene.ts` — `installShowcaseScene` authors the Main Camera into the scene
- `apps/studio/src/scene-bootstrap.ts` — `setupViewportScene`: Main Camera → Game tab redirect + ensure-main-camera promotion; the imperative game-camera spawn removed
