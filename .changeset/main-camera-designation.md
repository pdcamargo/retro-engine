---
'@retro-engine/engine': minor
---

feat(engine): `MainCamera` marker designating the primary game view

Per ADR-0081, adds a pure marker component that designates the principal game camera — the one a player sees through and a host (such as an editor) drives into its main viewport. It is a *designation*, not a render input: the render loop never consults it (which camera draws where stays governed by `Camera.target` / `Camera.order` / `Camera.isActive`); it exists so tooling and gameplay code can locate the principal camera by a stable query rather than by name or render order, mirroring Unity's `Camera.main`.

**New public surface:**

- `MainCamera` — empty marker component. Reflection-registered by `CameraPlugin` as `{ name: 'MainCamera' }`, so it round-trips in any saved scene. A scene is expected to carry at most one; the engine does not enforce or auto-assign it.
