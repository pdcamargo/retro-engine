# Engine Core — current state

Covers `packages/ecs`, the non-render concerns of `packages/engine`, `packages/math`, and
`packages/reflect`. Rendering lives in [`renderer.md`](renderer.md); animation in
[`animation.md`](animation.md); assets in [`assets.md`](assets.md).

**Shape to know up front:** `packages/ecs` is a *pure archetypal storage layer only* — World,
Archetype, Query, entity/component types, change-detection tick helpers. Everything else usually
called "ECS" (commands, resources, systems, scheduling, events, observers, hooks, relationships)
lives in `packages/engine`. The engine core is unusually deep on ECS/reflection/scenes; the honest
holes are the **runtime pillars a game needs**: input, audio, windowing, physics.

---

## ECS storage & queries

- ✅ **Entities** — opaque branded `Entity = number`, `componentId` interner (`ecs/src/types.ts`).
  Monotonic ids, **no recycling/generations** (`ecs/src/world.ts`); `reserveEntity`/`spawnReserved`
  for deferred spawn. `Disabled` marker excluded from queries by default. (ADR-0005)
- ✅ **Archetypal storage** — parallel columns (value + `changedTick` + `addedTick`) per type, swap-remove,
  archetype keyed by sorted component-id join (`ecs/src/archetype.ts`). Hashmap-of-archetypes (not a
  cached transition graph — each structural change re-derives the key). (ADR-0005)
- ✅ **Required components** — `static requires = [...]`, transitive with cycle detection + default
  construct (`ecs/src/archetype.ts`); e.g. `Transform.requires = [GlobalTransform]`.
- ✅ **Queries & filters** — `with`/`without`/`has`/`changed`/`added` (`ecs/src/query.ts`, `world.ts`).
  Three iteration backends: allocating iterator, `entries()`, and non-allocating `forEach()`.
  `.first()`/`.single()`/`.count()`.
  - 🟡 **Missing combinators**: no `Or<...>`, no first-class `Added`/`Changed` row wrappers (they are
    archetype+row tick gates), no query joins, no in-iteration sort.
- ✅ **Change detection** — monotonic `changeTick`, per-system pre-run snapshot (`engine/src/schedule.ts`),
  `Added ⟹ Changed` invariant by construction. In-place mutation needs explicit
  `world.markChanged(entity, T)` (the known ergonomics gap — ADR-0012). `RemovedComponents` param buffers
  removals, drained at frame boundary.

## Systems, commands, resources, events

- ✅ **Commands / EntityCommands** — per-system buffer keyed by `SystemId`, flushed *immediately* after
  each system returns (`engine/src/commands.ts`, ADR-0009). `withChildren`/`addChild`/`despawnRecursive`/
  `trigger`/`observe`. Re-entrant flush with a depth cap.
- ✅ **Resources** — keyed by constructor; `Res`/`ResMut`/`ChangedRes`/`ResAdded` params. Resource change
  detection is **frame-counter based** (not tick-based). `whenResource` for order-independent wiring
  (ADR-0128). (ADR-0016, ADR-0069)
- ✅ **Messages** (Bevy `Events` renamed) — frame-buffered channels, `MessageWriter`/`MessageReader`,
  per-system `lastSeenTick` gating, frame-boundary drain (`engine/src/messages.ts`, ADR-0013). Same v1
  caveat as Bevy: a `runIf`-skipped reader loses that frame's messages.
- ✅ **Observers & component hooks** — global + entity-targeted observers, `onAdd`/`onInsert`/`onReplace`/
  `onRemove` hooks, `Trigger<E>` param, `MAX_TRIGGER_DEPTH=8` (`engine/src/observers.ts`, ADR-0013/0015).
  🟡 **Caveat**: hooks fire only through the Commands flush path — direct `world.spawn`/`insertBundle`
  do **not** fire hooks.
- ✅ **Run conditions** — composable `RunCondition` (`.and`/`.or`/`.not`), `inState`/`resourceExists`/
  `resourceChanged`/`anyWithComponent` (`engine/src/run-conditions.ts`). Per-system only.
- 🟡 **System ordering** — label-based `before`/`after` within a stage, Kahn topo-sort + cycle detection.
  **No `SystemSet` type**, no set-level config, no `.chain()`, no ambiguity detection. (`engine/src/schedule.ts`)
- ❌ **Exclusive systems** — no `&mut World` param; whole-world systems capture `app` in a closure.
- ❌ **Parallel execution** — scheduler is explicitly single-threaded/synchronous. Param-token caching +
  componentId interning exist as groundwork, but no planner/executor.

## App, plugins, schedules, states

- ✅ **App** — main `world` + per-frame `renderWorld`, resources, stages, plugin/state/message/observer
  registries; `advanceFrame` + rAF `run`; headless mode (`engine/src/index.ts`).
- ✅ **Plugins** — `PluginObject` with `build`/`ready`/`finish`/`cleanup`, `PluginGroupBuilder`, build-stack
  attribution for system origin (`engine/src/plugin.ts`, ADR-0011).
- 🟡 **Schedules/stages** — fixed `Stage` union (`first`/`startup`/`preUpdate`/`update`/`postUpdate`/`last`/
  `render` + fixed-loop stages) plus internal `StateTransition`/`RunFixedMainLoop`. **Hardcoded enum, not a
  user-extensible schedule graph.** Fixed timestep with accumulator + 8-substep spiral cap. `describeSchedule()`
  + optional `SystemProfiler` (ADR-0008, ADR-0086).
- 🟡 **States** — `initState`, `State`/`NextState`, `onEnter`/`onExit`/`onTransition` (per-pair only),
  state-scoped **resources**, `inState` (`engine/src/state.ts`). **No computed/sub-states, no `StateScoped`
  entity despawn.**
- 🟡 **Sub-apps** — exactly one hardcoded second world (`renderWorld`) with an `Extract` param (ADR-0019).
  **No generic `SubApp` registry/API.**

## Transforms & hierarchy

- ✅ **Transforms** — `Transform` (TRS, one component for 2D+3D) + `GlobalTransform` (`Mat4`), compose/
  decompose with mirror/shear handling (`engine/src/transform.ts`, ADR-0010).
- ✅ **Hierarchy** — hardcoded `Parent`/`Children` maintained by command sugar + hooks; recursive despawn via
  `onRemove(Children)` (ADR-0014). `Children` is derived (rebuilt from `Parent`, not serialized).
  🟡 **No generic relationships** (Bevy 0.16-style) — only `Parent`/`Children`.
  🟡 **No sibling ordering** (reparent yes, persistent order no — backlog/hierarchy-sibling-reordering.md).
- ✅ **Propagation** — gated `propagateTransformsGated` in `postUpdate` (dirty set BFS over `Children`,
  depth-sorted, orphan+cycle detection); targeted `recomputeWorldSubtree` for the IK post-pass
  (`engine/src/hierarchy.ts`, ADR-0010/0016).

## Reflection, serialization, scenes, prefabs

- ✅ **Reflection** — `packages/reflect`: `TypeRegistry` (stable name → `static typeName` → `ctor.name`,
  ADR-0088), the `t` vocabulary (scalars, vec/quat/mat4/color, array/tuple/struct/enum, entity/handle/
  nested type/`t.variant` discriminated unions), modifiers (`.optional/.nullable/.skip/.default/.meta`),
  compile-time `Schema<T>` coherence, versioned migrations, `unregister` for hot reload, codec with
  injected encode/decode env + diffing. (ADR-0060/0063/0069/0088)
- ✅ **Scenes** — `.rescene` YAML (ADR-0089), `serializeWorld`/`serializeScene`/`serializePrefab` +
  two-phase `deserializeScene`; entities/components/resources/observer-bindings/template-refs/scene-refs/
  derived-overrides/attachments; `SceneRoot`/`SceneInstance`, scene reactor, selective streaming,
  state-gated loading (`engine/src/scene/`, ADR-0062/0068/0071/0100). 🟡 `deserializeScene` does not fire
  lifecycle hooks; a hook-firing `spawnScene` path exists.
- ✅ **Prefabs & bundles** — templates (`defineTemplate`/`spawnTemplate`, ADR-0067), Prefab asset kind
  `.reprefab` (ADR-0136), bundles `.rebundle` (ADR-0108). Scene composition + derived-entity overrides
  (ADR-0071/0113). 🟡 nested-scene per-instance overrides deferred (backlog/nested-scene-instance-overrides.md).
- ✅ **Type-registry wiring** — `AppTypeRegistry` resource; `registerComponent`/`registerType`/
  `registerResource`/`registerBundle`; per-plugin registration (ADR-0061/0064).

## Time, diagnostics, math

- ✅ **Time** — `virtual` (pausable/scalable), `real`, `fixed`, `frame` counter; delta clamped to 100ms;
  ticked in `first` stage (`engine/src/time.ts`, ADR-0008).
- 🟡 **Diagnostics/logging** — `Logger`/`ConsoleLogger` with severities + categorized `child()` (ADR-0007);
  `SystemProfiler` behind `profileSystems` (ADR-0086). **No `DiagnosticsStore`** (FPS/frame-time/entity-count/
  asset diagnostics).
- 🟡 **Math** — `packages/math` re-exports `wgpu-matrix` (vec/mat/quat) as primary; first-party additions:
  `aabb`, `frustum`, `plane`, `ray`, `screen-scale`, a small `Color`/`Colors`. **No** curves/splines,
  easing, random/noise, color-space conversions beyond sRGB, OBB/bounding-sphere types, 2D rect math.

## Hot code reload

- ✅ **Live plugin swap** — `App.removeUserPlugins(baseline)` + `App.addPluginsHot(plugins)`; rebuild →
  serialize → respawn → swap-on-success, no page reload (ADR-0102). 🟡 **Known gaps**: user-registered
  global observers/hooks are not removed on swap (they stack); selection cleared not remapped
  (backlog/hot-reload-observer-hook-removal.md).

---

## Absent runtime pillars (the shippable-game gap)

These do not exist in the runtime and are the reason a complete game can't ship yet. All are P0/P1 in
[`../roadmap/MASTER-ROADMAP.md`](../roadmap/MASTER-ROADMAP.md).

- ✅ **Input** — `@retro-engine/input` (ADR-0144/0145/0146): keyboard + mouse + action map + gamepad +
  touch. `ButtonInput<T>` / `Axis<T>` primitives; `KeyboardInput` / `MouseButtonInput` / `MouseMotion` /
  `MouseScroll` / `CursorPosition` resources; an `InputBackend` HAL (`DomInputBackend` + headless);
  `InputPlugin` (opt-in, headless-safe); a component-based `ActionMap` (reflection-registered) + derived
  `ActionState` with composite axes / virtual D-pads; a poll-based `Gamepads` resource (`GamepadSource` +
  Standard-Gamepad mapping + dead zones + connect/disconnect); and a `Touches` resource (active touch
  points with a per-frame lifecycle). Remaining are P1 niceties: gamepad-in-action-map, touch gesture
  recognizers, and a studio binding editor. → roadmap/input-system.md
- ✅ **Audio** — `@retro-engine/audio` (ADR-0147): HAL + Web Audio backend (`WebAudioBackend` +
  `NullAudioBackend`), an `AudioClip` asset (encoded bytes, lazy-decoded + cached) on `.wav`/`.ogg`/`.mp3`,
  an `Audio` resource (play/stop/volume/pitch/loop, one-shot + looping, autoplay-resume), and
  component-based `AudioSource` + `AudioListener` (reflection-registered) with an ECS playback system
  (`reconcileAudio`: playOnAdd, despawnOnEnd, live volume sync). `AudioPlugin` is opt-in + headless-safe.
  **Mixer buses** (named buses + per-bus volume, submix trees, filter/compressor effect inserts) and
  **spatial audio** (stereo panning + linear distance attenuation off the `AudioListener`, ADR-0165/0168)
  are shipped. Remaining are P1/P2: inverse/3D `PannerNode` falloff, reverb/sidechain, studio audio preview.
  → roadmap/audio.md
- ❌/🟡 **Windowing** — only a raw canvas + `ResizeObserver` + surface configure on the App. No `Window`
  resource, monitor/cursor/fullscreen control, multi-window, or window events.
- ✅ **Physics** — `@retro-engine/physics-core` + `@retro-engine/physics-rapier` (ADR-0148). Contract
  (`PhysicsBackend` + `PhysicsCapabilities` + `NullPhysicsBackend`); Avian-shaped `2d`/`3d` components
  (`RigidBody`, `Collider`, `LinearVelocity`, `AngularVelocity`, `ExternalForce`, `Restitution`/`Friction`/
  `GravityScale`/`Sensor`, `CharacterController`, `Joint`), reflection-registered; `Gravity`/`Physics`
  resources; `PhysicsPlugin` fixed-timestep Sync→Step→Writeback bridge. The **Rapier 2D+3D** backend
  (`createRapierBackend`) gives real dynamics, raycasts, collision events (→ ECS `CollisionEvent` message),
  a kinematic **character controller** (collide-and-slide + grounded), and **joints** (fixed/revolute/
  prismatic/spherical) — all verified by deterministic headless tests. Studio integration (collider
  gizmos, debug draw, inspector) is the P1/P2 remainder. → roadmap/physics.md

## Planned architecture — physics package (not built yet)

Locked design (see the approved plan and a future ADR when work starts). Mirrors the renderer HAL
pattern exactly (leaf abstraction + injected backend, CLAUDE.md §5):

- `packages/physics-core/` (leaf; depends only on `math` + `ecs` types) — `PhysicsBackend` interface,
  `PhysicsCapabilities` struct (day-1 flags like the renderer), and **Avian-shaped, `2d`/`3d`-suffixed
  ECS components** (reflection-registered per §13). Both dimensionalities coexist and the ECS keys by
  constructor, so — exactly like `Camera2d`/`Camera3d`, `Mesh2d`/`Mesh3d` — there are two families:
  - 2D: `RigidBody2d`, `Collider2d`, `LinearVelocity2d` (Vec2), `AngularVelocity2d` (scalar),
    `ExternalForce2d`, `LockedAxes2d`, joint2d, …
  - 3D: `RigidBody3d`, `Collider3d`, `LinearVelocity3d` (Vec3), `AngularVelocity3d` (Vec3),
    `ExternalForce3d`, `LockedAxes3d`, joint3d, …
  - Genuinely-scalar config (`Restitution`, `Friction`, `GravityScale`, `Sensor`) may be shared unsuffixed.
  - Derived/runtime state (contact caches, backend handles) is deliberately-not-serialized.
- `packages/physics-rapier/` (backend) — Rapier-WASM (`@dimforge/rapier2d-compat` under `*2d`,
  `rapier3d-compat` under `*3d`); Sync → Step → Writeback bridge + entity↔body maps. Injected at App
  startup, never imported by `engine` directly.
- `PhysicsPlugin` in the engine schedules sync/step/writeback in the **fixed timestep**.
- Future: `packages/physics-xpbd/` (from-scratch solver) can implement the same interface with no
  gameplay-code churn.

## Notable ECS gaps vs Bevy (all tracked in the roadmap)

`SystemSet`/set config/ambiguity detection/`.chain()`, exclusive systems, generic relationships, generic
sub-apps, parallel executor, computed/sub-states + `StateScoped` entities, `DiagnosticsStore`, task pools /
async asset processing.
