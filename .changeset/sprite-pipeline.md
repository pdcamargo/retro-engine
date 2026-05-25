---
'@retro-engine/engine': minor
---

feat(engine): Sprite component + SpritePipeline + Core2d phase trio

Phase 8.1 lands the batched sprite pipeline — the 2D twin of Phase 7's `Mesh3d + MaterialPlugin` slice. Per ADR-0031. Cameras spawned via `Camera2d()` now drive an `Opaque2dNode → Transparent2dNode` phase trio (replacing the Phase 7 `MainPassNode` shim), and a new `SpritePlugin` pushes one instanced draw per `(ImageHandle, alphaBucket)` batch into `ViewPhases2d`.

**New public surface:**

- `Sprite` — ECS component carrying `{ image: ImageHandle | undefined; color: Vec4; customSize?: Vec2; rect?: Rect; anchor: SpriteAnchor; flipX: boolean; flipY: boolean }`. `image: undefined` resolves to `Images.WHITE` at queue time, so `new Sprite({ color, customSize })` is a usable solid-tint quad with no image plumbing. Required components: `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`, `ViewVisibility`.
- `SpriteAnchor` — `'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | { x: number; y: number }`. Bevy parity: 0..1 within the sprite's footprint.
- `Rect` — `{ min: Vec2; max: Vec2 }` value class. Used as a render-from sub-rect of the source image; forward-compatible with the Phase 8.2 `TextureAtlas` asset.
- `SpritePlugin` — engine plugin owning the built-in batched pipeline. Registers `retro_engine::sprite` WGSL, inserts the pipeline + instance-buffer resources, registers prepare + queue systems.
- `SpritePipeline` — render-world resource holding the shared quad VBO/IBO, the `SpecializedRenderPipelines<SpriteKey>`, and the per-image `BindGroup` cache. Exposed for downstream introspection and for tests.
- `SpriteInstanceBuffer` — render-world resource owning the growable per-frame instance VBO + scratch.
- `SpritePreparedBatches`, `SpriteBatch`, `SpriteKey`, `SpriteAlphaBucket`, `SpriteOptions`, `SpriteSpecializeContext` — supporting types for plugins that consume or replace pieces of the pipeline.
- `packSpriteInstance`, `SPRITE_INSTANCE_BYTE_SIZE`, `SPRITE_INSTANCE_FLOAT_COUNT`, `resolveAnchor` — pack-path helpers exposed for benches and downstream tooling.
- `SPRITE_WGSL` — the registered shader source.
- `PhaseItem2d` interface + `ViewPhases2d` render-world resource — the 2D twin of `PhaseItem3d` / `ViewPhases3d`. Maps keyed by main-world camera entity id; `pushOpaque` / `pushAlphaMask` / `pushTransparent` / `clear` methods mirror the 3D shape.
- `OpaquePass2dNode`, `OpaquePass2dLabel`, `TransparentPass2dNode`, `TransparentPass2dLabel` — new render-graph nodes that drain `ViewPhases2d`.
- `makeCapturingRenderer` — test-utility renderer that records every `RenderPassEncoder` interaction, surfacing a `CapturedDrawLog` so tests can assert how many draws ran with which bind groups.
- `attachLegacyMainPassToCore2d` — test-utility helper to re-attach `MainPassNode` to the Core2d sub-graph for tests exercising the legacy `RenderSet.Render` + `RenderCtx` path.

**Breaking changes:**

- `buildCore2dSubGraph()` no longer registers `MainPassNode`. Cameras with `subGraph: Core2dLabel` now run `OpaquePass2dNode → TransparentPass2dNode` instead. User code that depended on the implicit `RenderSet.Render` open-pass behaviour (a registered render-stage system with no explicit `set`) sees the system invoked outside any open render pass, so `RenderCtx`-based draws silently no-op. Migrate to either pushing a `PhaseItem2d` into `ViewPhases2d` from a `RenderSet.Queue` system or to a custom sub-graph that adds `MainPassNode` manually (the symbol remains exported).
