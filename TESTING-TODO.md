# Testing TODO — morning review queue

Autonomous build-loop output. One line per finished item; a HOW-to-test note when
it isn't obvious. Items here were verified by unit tests + a build-green gate but
could **not** be exercised via the retro-studio MCP (no path exists), so they need
a manual confirmation before their backlog/roadmap entries are considered closed.

---

## Input system — Phase 1 (keyboard + mouse) · `@retro-engine/input` · ADR-0144

- **What changed:** New `@retro-engine/input` package: `ButtonInput<T>` / `Axis<T>`
  primitives; `KeyboardInput`, `MouseButtonInput`, `MouseMotion`, `MouseScroll`,
  `CursorPosition` resources; an `InputBackend` HAL (`DomInputBackend` +
  `HeadlessInputBackend`); `InputPlugin` (opt-in, headless-safe, `preUpdate`
  clear-then-drain lifecycle). Wired into the playground as `?mode=input`.
- **Automated:** 30 unit tests (button/axis/frame-lifecycle/backend-selection) green;
  lint/typecheck/test/build/bench all green. A per-frame bench (`applyInputFrame`)
  joined the suite (`packages/input/bench`, added to `bench:check`).
- **Why no MCP verification:** input needs real key/mouse events; the retro-studio
  MCP has no key-injection tool, and synthetic canvas events don't drive jsimgui.
  So this is unit-tested + manual.
- **HOW to test (manual):** run the playground (`cd apps/playground && bun run dev`),
  open `http://localhost:<port>/?mode=input`, click the canvas to focus it, then:
  - **WASD / arrow keys** move the white square; **release** stops it.
  - **Space** snaps it back to the origin.
  - **Hold left mouse button** → the square tints cyan; release → white.
  - **Mouse wheel** scales the square (0.4×–4×).
  - Live state is on `window.__input` (`{x, y, scale, pressed, cursor}`) — check it
    in the dev console to confirm resources update without eyeballing pixels.
- **Not deleted:** `docs/roadmap/input-system.md` stays (Phases 2–5 remain: action
  map + reflection, gamepad, touch, studio binding editor). `MASTER-ROADMAP.md`
  Input box left unchecked until the full AC (gamepad/touch/action-map) lands.

---

## Input system — Phase 2 (action map) · `@retro-engine/input` · ADR-0145

- **What changed:** Component-based action layer (leafwing-shaped). `ActionMap`
  (authored, reflection-registered, serialized) + `ActionState` (derived,
  auto-attached, not serialized). Fluent builder (`.button`/`.axis`/`.axis2d`) with
  `key()`/`mouseButton()` sources; per-frame resolver runs in `preUpdate` after the
  raw device update. Playground `?mode=input` now drives the sprite through the
  action map and rebinds `Reset` at runtime.
- **Automated:** +10 unit tests (builder, resolve semantics for button/axis/axis2d,
  many-to-many, reflection round-trip via `TypeRegistry`) — 40 input tests green;
  a `resolveActionState` bench joined the suite; full repo gate green.
- **Why no MCP verification:** same as Phase 1 — no key-injection path.
- **HOW to test (manual):** playground `?mode=input`, focus the canvas:
  - **WASD / arrow keys** move the square (via the `Move` / `MoveArrows` axis2d).
  - **Space** resets to origin (the `Reset` action). Press **R** to rebind Reset to
    **Enter** (then Enter resets, Space doesn't); press **R** again to swap back —
    `window.__input.resetKey` shows the current binding.
  - **F or left mouse** tints the square (the `Fire` action).
  - `window.__input` also exposes `{move:{x,y}, fire}` resolved from the action map.
- **Reflection check:** the `ActionMap` schema round-trips (unit test), so bindings
  will survive a scene save once the studio persists this component.

---

## Input system — Phase 3 (gamepad) · `@retro-engine/input` · ADR-0146

- **What changed:** Poll-based gamepad support. `GamepadSource` (`NavigatorGamepadSource`
  + `HeadlessGamepadSource`), `Gamepads` resource keyed by pad index with per-pad
  `ButtonInput<GamepadButton>` + `Axis<GamepadAxis>`, W3C Standard-Gamepad mapping
  (named buttons/axes; stick-Y flipped so up=+1; triggers as [0,1] axes), configurable
  dead zone, connect/disconnect via poll reconciliation. Polled in `preUpdate`.
- **Automated:** +11 unit tests (dead zone, connect/read, button edges, triggers,
  disconnect lifecycle, non-standard raw access, multi-pad) — 50 input tests green;
  an `updateGamepads` bench joined the suite; full repo gate green.
- **Why no MCP verification:** no gamepad-injection path (and no physical pad in CI).
- **HOW to test (manual):** plug in an Xbox/PS controller, open playground `?mode=input`,
  press any button on the pad once (browsers only expose a gamepad after first input),
  then: **left stick** moves the square; **A / ✕ (South)** tints it. `window.__input.gamepad`
  shows `{connected, x, y, south}`. If you have no controller, this phase is covered by
  the unit tests only — the `Gamepads` API is driven by a scriptable `GamepadSource`.
- **Follow-up (not done):** gamepad bindings in the action map (rebindable gamepad) —
  logged as a new MASTER-ROADMAP item.

---

## Input system — Phase 4 (touch) · `@retro-engine/input` · ADR-0144

- **What changed:** `Touches` resource of active `TouchPoint`s (id, position,
  start position, per-frame delta, phase) with a `ButtonInput`-style lifecycle
  (`justStarted`/`justEnded`, `iter`/`first`/`count`). DOM backend emits
  touchstart/move/end/cancel; folded into the same `preUpdate` frame step.
- **Automated:** +3 unit tests (start→move→end lifecycle, multi-touch, cancel) —
  53 input tests green; touch events added to the `applyInputFrame` bench; full gate green.
- **Why no MCP verification:** no touch-injection path.
- **HOW to test (manual):** playground `?mode=input`, open browser devtools and
  enable **touch/device emulation**, then drag on the canvas — `window.__input.touches`
  shows `{count, x, y}` for the primary touch. Without a touch device this is covered
  by the unit tests (a scriptable `QueueBackend` feeds touch events).

---

## Audio system — Phase 1 (HAL + Web Audio + AudioClip) · `@retro-engine/audio` · ADR-0147

- **What changed:** New `@retro-engine/audio` package. `AudioBackend` HAL +
  `WebAudioBackend` (AudioContext, lazy decode cache, per-voice source→gain→master,
  autoplay-resume) + `NullAudioBackend`; `AudioClip` asset (encoded bytes) + importer +
  `.meta` kind on wav/ogg/mp3; `Audio` resource facade (play/stop/volume/pitch/loop,
  one-shot + looping); `AudioPlugin` (opt-in, headless-safe). Playground `?mode=audio`.
- **Automated:** 6 unit tests (importer defensive-copy, NullAudioBackend, `Audio` facade
  routing incl. handle resolution) green; lint/typecheck/test/build green. No bench (no
  headless-benchable per-frame path yet; Phase 2's `AudioSource` sync will carry one).
- **Why no MCP verification:** audio needs a real `AudioContext` + speakers; no MCP path,
  and headless bun has no Web Audio (unit tests use a mock/null backend).
- **HOW to test (manual):** playground `?mode=audio`, **click the canvas once** (browsers
  keep audio suspended until a gesture — the backend resumes on that click), then:
  - **Space / left-click** → a short beep at a random pitch (one-shot; overlapping plays OK).
  - **M** → toggle a looping low tone (music); M again stops it.
  - `window.__audio` shows `{ suspended, oneShots, looping }`.
- **Not deleted:** `docs/roadmap/audio.md` stays (Phase 2 ECS components + mixer buses remain).
  MASTER-ROADMAP Audio box left unchecked until Phase 2 (`AudioSource`/`AudioListener` + sample).

---

## Audio system — Phase 2 (ECS playback) · `@retro-engine/audio` · ADR-0147

- **What changed:** Component-driven audio. `AudioSource` (clip handle, volume, pitch,
  loop, playOnAdd, despawnOnEnd, play()/stop()) + `AudioListener` (master volume),
  reflection-registered; `AudioVoices` runtime resource; `reconcileAudio` playback
  system in postUpdate (playOnAdd retry-until-loaded, explicit play/stop, live volume
  sync, despawn/drop finished one-shots, stop-on-removal). Listener → master gain.
- **Automated:** +9 unit tests (playOnAdd + retry, play/stop, volume sync, despawnOnEnd,
  loop-never-finishes, stop-on-removal) — 15 audio tests green; `reconcileAudio` bench
  joined the suite; full repo gate green.
- **Why no MCP verification:** same as Phase 1 — needs a real AudioContext + speakers.
- **HOW to test (manual):** playground `?mode=audio`, click the canvas once (resumes audio),
  then: looping **music** starts automatically (an `AudioSource` entity); **Space / left-click**
  spawns a one-shot beep entity that despawns itself when done (`despawnOnEnd`); **M** toggles
  the music (source.play()/stop()). `window.__audio` shows `{ oneShots, musicPlaying, voices }`
  (voices = live `AudioVoices.size`).

---

## Physics — Phase 1 (physics-core contract + components) · `@retro-engine/physics-core` · ADR-0148

- **What changed:** New `@retro-engine/physics-core` package. `PhysicsBackend` interface +
  `PhysicsCapabilities` + `NullPhysicsBackend`; Avian-shaped `2d`/`3d` components (RigidBody,
  Collider, Linear/Angular velocity, ExternalForce, Restitution/Friction/GravityScale/Sensor),
  reflection-registered; `Gravity` + `Physics` resources; `PhysicsPlugin` runs the
  Sync→Step→Writeback bridge in the fixed timestep (no-op until a backend is injected).
- **Automated:** 16 unit tests (component factories, bridge snapshot/writeback/collider-desc/
  angle, null backend, reflection round-trip incl. vec2/vec3/enum) green; a snapshot bench joined
  the suite; full repo gate green.
- **Why not verified in the studio yet:** nothing moves without a backend — real behavior arrives
  in Phase 2 (physics-rapier). Phase 1 is contract + components, unit-tested.
- **HOW to test (manual, later):** nothing visible yet — Phase 2 will add a `?mode=physics`
  playground demo (boxes fall + land). For now: `bun test` in packages/physics-core is green, and
  the components will appear in the studio Add-Component list once a project loads the plugin.
- **Not deleted:** `docs/roadmap/physics.md` stays (Phase 2 rapier backend + Phase 3 3D/character/
  joints/events remain). MASTER-ROADMAP Physics box left unchecked until real simulation ships.

---

## Physics — Phase 2 (Rapier 2D backend) · `@retro-engine/physics-rapier` · ADR-0148

- **What changed:** New `@retro-engine/physics-rapier` package: `createRapierBackend()` over
  `@dimforge/rapier2d-compat` — real 2D dynamics implementing the full `PhysicsBackend` contract
  (async wasm gate, entity↔body maps, upsert/step/readBody/remove, gravity/gravity-scale/
  external-force/kinematic, raycast, collision-event drain). Playground `?mode=physics` demo.
- **Automated (REAL verification):** 4 deterministic bun tests using the actual Rapier wasm —
  a dynamic box falls under gravity and lands on a static floor (y: 5 → ~1.0), gravityScale 0
  floats, removeBody drops the body, 3D snapshots ignored. This is genuine physics verification,
  not just a compile. Full repo gate green (41 typecheck / 23 lint / 40 test / build).
- **HOW to test (manual, visual):** run the playground (`cd apps/playground && bun run dev`), open
  `?mode=physics`, click the canvas: 5 colored boxes fall and **stack on the grey floor**; press
  **Space** to drop more from the top (random x). `window.__physics` shows `{ready, boxes, lowestY}`.
- **Not deleted:** `docs/roadmap/physics.md` stays. MASTER-ROADMAP Physics box still unchecked —
  Phase 3 (3D via rapier3d-compat, kinematic character controller, joints, ECS collision events)
  remains for the full P0 AC.

---

## Physics — 3D backend · `@retro-engine/physics-rapier` · ADR-0148

- **What changed:** `createRapierBackend()` is now dimension-aware — internal `world-2d.ts` +
  `world-3d.ts` adapters (rapier2d-compat / rapier3d-compat), routed by snapshot dimension;
  `capabilities.dimensions3d = true`. 3D: Vec3 translation, quaternion rotation, Vec3 angular
  velocity, cuboid(hx,hy,hz)/ball/capsule.
- **Automated (REAL):** 5 deterministic bun tests on the actual wasm — a 3D box falls + lands
  on a floor (rotation is a quaternion), and a mixed scene runs 2D + 3D bodies independently.
  Full repo gate green.
- **HOW to test (manual):** the 2D `?mode=physics` demo is unchanged (still uses the 2D path);
  a dedicated 3D visual demo (Camera3d + meshes) will land with the character-controller phase.
  The 3D backend itself is proven by the deterministic tests.
- **Remaining for the Physics box:** kinematic character controller, joints, and collision
  events surfaced to ECS (a message channel).

---

## Physics — collision events → ECS · `@retro-engine/physics-core` + `physics-rapier` · ADR-0148

- **What changed:** `CollisionEvent` is now an ECS message class; `PhysicsPlugin` writes the
  backend's drained start/stop events each fixed step. Rapier colliders now enable
  `ActiveEvents.COLLISION_EVENTS` (they're silent otherwise). Read via `MessageReader(CollisionEvent)`.
- **Automated (REAL):** a headless bun test drops a box on the floor and asserts a `started`
  collision event is emitted between the two entities. 6 rapier tests green; full gate green.
- **HOW to test (in a game):** add a system with `MessageReader(CollisionEvent)`; each `{kind:'started'
  |'stopped', a, b}` reports a contact between entity `a` and `b`. (Manual: wire it into a scene and
  log hits; not visually verifiable on its own.)
- **Remaining for the Physics box:** kinematic character controller + joints (+ a moving-character demo).

---

## Physics — kinematic character controller · `physics-core` + `physics-rapier` · ADR-0148

- **What changed:** `CharacterController2d`/`3d` components (offset, slope limits, autostep,
  snap-to-ground, `desiredTranslation` input, `grounded` output) + `PhysicsBackend.moveCharacter`.
  The Rapier backend drives a per-entity `KinematicCharacterController` (2D + 3D); the bridge moves
  the character by the collision-corrected amount each fixed step and writes back `grounded`.
- **Automated (REAL):** 8 rapier tests — a kinematic character walks along a floor and stays grounded,
  and is stopped by a wall (collide-and-slide). Full repo gate green.
- **HOW to use (game):** spawn an entity with `Transform` + `RigidBody2d.kinematic()` +
  `Collider2d.capsule(...)` + `new CharacterController2d({ snapToGroundDistance: 0.5 })`; each frame set
  `cc.desiredTranslation` (e.g. from input + gravity) and read `cc.grounded`.
- **Remaining for the Physics box:** joints (fixed/revolute/…).

---

## Physics — joints · `physics-core` + `physics-rapier` · ADR-0148

- **What changed:** `Joint2d` (fixed/revolute/prismatic) + `Joint3d` (+spherical) components (target
  entity, local anchors, axis; reflection-registered) + `PhysicsBackend.upsertJoint`/`removeJoint`
  over Rapier `ImpulseJoint`. The bridge creates joints once both bodies exist, removes on component
  removal / body despawn. `capabilities.joints = true`.
- **Automated (REAL):** headless test — a fixed joint holds a dynamic body against gravity; removing
  the joint lets it fall. 9 rapier tests green; full gate green.
- **HOW to test (in a game / studio):** attach `new Joint2d(otherEntity, 'fixed', { localAnchorB: [...] })`
  to a body; the two bodies stay constrained. (Manual visual demo pending studio physics gizmos.)

---

## ✅ P0 Physics item COMPLETE — box checked in MASTER-ROADMAP

The **Physics** P0 item is fully done: `physics-core` contract + Avian components (reflection) +
`physics-rapier` **2D & 3D** backend with real dynamics, collision events → ECS, a kinematic
character controller, and joints — all with deterministic headless tests. Playground `?mode=physics`
demos falling/stacking boxes + a walking character (Space drops more; A/D or arrows move the character).
Reference tag ✅. Studio integration (collider gizmos / debug draw / inspector) moved to P1.
**Three P0 items now complete: Input, Audio, Physics.** Next P0: Engine text (MSDF) or the two
stabilization bug fixes.

---

## Fix — malformed material uniform no longer freezes the render loop · `engine` · bug

- **What changed:** (1) `StandardMaterial` validates/pads `baseColor`/`emissive` at construction (short
  → padded from default, e.g. `emissive:[1,1,1]`→`[1,1,1,0]`; non-array/non-number → throws clearly).
  (2) `MaterialPlugin.prepareMaterials` wraps each material's uniform pack in try/catch — a throwing
  material is logged once and skipped, the rest of the scene keeps rendering.
- **Automated:** unit tests — constructor padding/rejection (standard-material.test.ts) + a deliberately
  malformed material is skipped while a good one still prepares (material-plugin.test.ts). Full gate green.
- **Why bug file kept:** verified by unit tests, not the studio MCP — so per the loop rule I left
  `docs/bugs/malformed-material-uniform-breaks-render-loop.md` for you to confirm & delete. The
  MASTER-ROADMAP box is checked (fix shipped + unit-verified).
- **HOW to confirm (manual, optional):** in the studio, set a `StandardMaterial.emissive` to a
  3-component value via `studio.eval` / a hand-edited `.remat` → the viewport keeps rendering (a dev
  warning is logged; the bad material is skipped) instead of freezing.

---

## Fix — mesh missing a required attribute no longer freezes the renderer · `engine` · bug

- **What changed:** `MaterialPlugin` checks (before building a pipeline) that a mesh's vertex layout
  provides every attribute the material requires (`Material.requiredMeshAttributes()`, default
  POSITION/NORMAL/UV_0). A mesh missing one has its draw skipped + one dev warning, instead of an
  invalid pipeline poisoning the frame encoder and freezing the viewport. Guards the mesh + skinned
  queue paths.
- **Automated:** `missingMeshAttributes` unit tests (missing UV / missing normal / full mesh). The
  actual GPU freeze can't be reproduced with the stub renderer (it doesn't validate pipelines), so the
  guard's *decision* is unit-tested; the end-to-end freeze-avoidance is by construction (skip before
  pipeline build). Also fixed a test fixture (`buildCube`) that was a UV-less mesh only "working"
  because the stub skips validation. Full gate green (1154 engine tests).
- **Why bug file kept:** unit-test-only verification (no MCP freeze-repro path) — left
  `docs/bugs/mesh-without-uv-freezes-renderer.md` for you to confirm & delete. MASTER-ROADMAP box checked.
- **HOW to confirm (manual, optional):** in the studio, add a mesh/glTF whose vertex data omits UVs and
  assign a `StandardMaterial` → the viewport keeps rendering (that mesh is skipped + a dev warning logged)
  instead of freezing.

---

## ✅ Both P0 stabilization bugs fixed — Input, Audio, Physics + both freezers = P0 progressing fast

Four P0 items + both stabilization freezers now done. Remaining P0: Engine text (MSDF), In-game UI
(depends on text), Play mode, Web export.

---

## ✅ P0 Audio item COMPLETE — box checked in MASTER-ROADMAP

The **Audio (core)** P0 item is fully done (HAL + Web Audio backend + `AudioClip` +
`AudioSource`/`AudioListener` + reflection + entity SFX/music sample; headless-safe).
Reference tag flipped to ✅. Mixer buses / spatial panning / studio audio preview are P1/P2.
Next P0 target: **Physics** (or Engine text / in-game UI).

---

## ✅ P0 Input item COMPLETE — box checked in MASTER-ROADMAP

The **Input system** P0 item is fully done (keyboard + mouse + action map + gamepad +
touch; headless-safe; reflection; sample). Reference tag flipped to ✅. Remaining input
work (gamepad-in-action-map, touch gestures, studio binding editor) moved to **P1**.
Next P0 target: **Audio (core)**.

---

## 🟡 Engine text (MSDF) — Phase 1 shipped (data + layout engine, pure)

The MSDF text system's algorithmic core landed under `packages/engine/src/text/`:
`MsdfFont`/`parseMsdfFont` (parses `msdf-atlas-gen` JSON, throws on malformed) and
`layoutText`/`measureText` (advances, kerning, `\n`, greedy word wrap at `maxWidth`,
left/center/right alignment, top-left-origin atlas UVs). **Pure logic — no GPU, no
component yet**, so verified by unit tests only (no MCP/editor path exists at this phase).

- **HOW to test:** `bun test packages/engine/src/text/` — 19 tests cover parsing,
  whitespace glyphs, kerning, wrapping/overflow, alignment, newlines, top/bottom atlas
  y-origin, and measure↔layout agreement.
- **Not yet visible in the studio.** Rendering (a `Font` asset kind + `.meta`, the
  `Text2d` component, the MSDF shader, glyph-quad batching through the 2D pipeline, and a
  `?mode=text` sample) is Phase 2 — that's when there'll be an on-screen thing to look at.
- Roadmap: `docs/roadmap/text-rendering.md`; decision: ADR-0149. MASTER-ROADMAP item
  marked 🟡 (box stays unchecked until Phase 2 renders text).

---

## 🟡 Engine text (MSDF) — Phase 2a shipped (Font asset + Text2d component)

The asset + component layer of MSDF text landed under `packages/engine/src/text/`:
`Font` (parsed `MsdfFont` + atlas `Handle<Image>`), `Fonts` store, `createFontImporter`
(parses a `.font` msdf-atlas-gen descriptor, decodes its companion atlas into a **linear**
image sub-asset — sibling `<base>.png` by default, or a top-level `"image"` override),
the `Text2d` component (text/font/size/color/align/lineHeight/maxWidth/letterSpacing/anchor,
reflection-registered), and `TextPlugin`. **Still no rendering** — no MSDF shader/batching
yet, and `TextPlugin` is deliberately not in the default plugin set. Verified by unit tests
only (no MCP path until Phase 2b draws pixels).

- **HOW to test:** `bun test packages/engine/src/text/` — 29 tests: importer (fake
  decoder + fake load-context; linear atlas, sibling derivation, `"image"` override,
  missing-sibling + malformed rejection), Text2d defaults, and a full scene
  serialize→deserialize round-trip of every Text2d field incl. the font handle GUID.
- **Not yet visible in the studio.** Phase 2b (MSDF WGSL shader, glyph-quad batching
  through the 2D pipeline, `?mode=text` sample, wiring TextPlugin into DefaultPlugins) is
  the next slice — that's when there's an on-screen thing to screenshot.
- Roadmap: `docs/roadmap/text-rendering.md` (Phase 2 split into 2a done / 2b next).
  Decision: ADR-0149. MASTER-ROADMAP item stays 🟡 until Phase 2b renders text.

---

## 🟡 Engine text (MSDF) — Phase 2b shipped (glyph render pipeline)

`TextPlugin` now actually renders `Text2d`. Added the `retro_engine::text` MSDF shader
(median-of-RGB distance + screen-px-range AA), `TextPipeline` (specialized on render-target
shape, always alpha-blended), `TextInstanceBuffer`, `packGlyphInstance` (block-local y-down
glyph → world-space quad honoring the entity transform + pivot, per-glyph atlas UV +
`unitRange`), and the `text-prepare` (after `image-prepare`) + `text-queue` render systems
(one instanced transparent draw per text entity).

- **HOW to test now:** `bun test packages/engine/src/text/` — 39 tests, incl. a
  capturing-renderer integration test asserting the transparent2d pass gets one instanced
  draw per text entity, correct instance counts (1 per visible glyph), per-entity batching,
  the atlas bound at `@group(1)`, and skip behavior (no font / whitespace-only → no draw).
  Bench: `bun run --cwd packages/engine bench --filter "text prepare"` (~65µs / 400 glyphs).
- **Still not visible on screen** — no committed font atlas yet, and `TextPlugin` isn't
  added by any sample/studio scene. Phase 2c commits a real `msdf-atlas-gen` font (.font +
  .png), adds a `?mode=text` playground scene, and wires TextPlugin alongside SpritePlugin —
  that's when there's an actual on-window screenshot to verify via the studio MCP.
- Roadmap: `docs/roadmap/text-rendering.md` (Phase 2 → 2a/2b done, 2c next). ADR-0149.
  MASTER-ROADMAP stays 🟡 until text is drawn on screen and MCP-verified.

---

## 🟡 Engine text (MSDF) — Phase 2c shipped (built-in SDF default font + ?mode=text sample)

No native `msdf-atlas-gen` is installed and headless bun can't rasterize system fonts, so
rather than block, I shipped a **pure-JS SDF font generator** (`generateSdfFont`) and a
**built-in default font** (`installDefaultFont`) — monoline stroke glyphs (uppercase, digits,
punctuation; lowercase aliased to uppercase) rasterized to a single-channel SDF the
median-of-RGB shader consumes unchanged. Zero external deps, zero committed binaries. Added a
`?mode=text` playground scene (title / multi-line / wrapped / right-aligned HUD / spinner).

- **HOW to test (headless):** `bun test packages/engine/src/text/` — 47 tests incl. SDF
  gradient/metrics/atlas checks and a capturing-renderer test drawing "HELLO" with the built-in
  font (5 instances).
- **HOW to test (visual — needs a WebGPU browser):** run the playground and open
  `?mode=text` → five text blocks in different sizes/colors/alignments + a spinning "SPIN!".
  Confirm glyphs are crisp when the window is resized/zoomed (SDF scale-independence) and the
  spinner's glyphs rotate with the entity.
- **Studio:** 2D render plugins are project-declared (like SpritePlugin), so open a studio
  project that adds `TextPlugin` + a `Text2d` entity to see text in the editor. Couldn't
  MCP-verify this session (studio relay disconnected — `studio_connected` = false).
- Roadmap: `docs/roadmap/text-rendering.md` (Phases 1–2c done). ADR-0149. MASTER-ROADMAP item
  stays 🟡 until visual confirmation + Phase 3 (world-space Text). A true multi-channel MSDF
  atlas via `msdf-atlas-gen` is an optional tooling upgrade — the `.font` importer already
  loads one; the built-in SDF font is the no-tooling default.

### Tooling note (not a hard blocker)
`msdf-atlas-gen` / `msdfgen` are not installed on this machine (checked `which` + brew + npm).
The engine ships a pure-JS SDF font instead, so text works without them. Installing
`msdf-atlas-gen` later would enable authoring true multi-channel MSDF fonts (sharper corners)
that load through the existing `.font` importer.

---

## 🟡 In-game UI (Retro CSS) — Phase 1a shipped (flexbox LayoutEngine)

New package `@retro-engine/ui` with the pure layout foundation: a `LayoutEngine` interface
+ `FlexLayoutEngine` — single-line CSS flexbox (main-axis grow/shrink with min/max clamping +
iterative freezing per §9.7, `justify-content`, `align-items`/`align-self`, `gap`,
padding/margin, `position: absolute` insets) with a text-measure callback hook, plus
`UiStyle`/`makeStyle`. Pure TS, no ECS/GPU.

- **HOW to test:** `bun test packages/ui/` — 21 tests (row/column, grow/shrink + min clamp,
  all justify-content modes, align stretch/center/end + align-self, gap, padding/margin,
  row-reverse, measure callback, absolute insets incl. left+right stretch, nested trees).
  Bench: `bun run --cwd packages/ui bench` (~51µs for a 271-node grid).
- **Not yet in the ECS or on screen.** Phase 1b adds `UiNode`/`ComputedLayout` + a `UiPlugin`
  layout system (walk hierarchy → run engine → write layout); Phase 2 renders through the 2D
  pipeline (quads + ADR-0149 glyphs); Phase 3 `.rss` styling; Phase 4 widgets. So nothing to
  screenshot yet — the layout math is verified purely.
- Roadmap: `docs/roadmap/ui-system.md` (rewritten to the retained-ECS + flexbox + `.rss`
  model). Decision: ADR-0150. MASTER-ROADMAP item is 🟡 (box stays unchecked until the UI
  renders styled widgets on screen).

---

## 🟡 In-game UI — Phase 1b shipped (UiNode/ComputedLayout + UiPlugin layout system)

The flexbox engine now runs from the ECS. Added `UiNode` (authored `UiStyle`,
reflection-registered — auto/no-max encoded as omitted `undefined`, so it round-trips),
`ComputedLayout` (derived absolute screen-space rect, not serialized, auto-attached via
required components), and `UiPlugin` — a `postUpdate` `ui-layout` system that mirrors the
`Parent`/`Children` hierarchy into a LayoutNode tree, runs the engine, and writes each
entity's `ComputedLayout` with accumulated absolute coordinates. `UiViewport` (root size) +
`UiLayout` (swappable engine) resources.

- **HOW to test:** `bun test packages/ui/` — 29 tests. Phase 1b covers: ComputedLayout
  auto-attach, a flex-row hierarchy → absolute rects, auto-root fills viewport, ancestor
  offset accumulation (nested padding), a UiNode under a non-UI parent treated as a root,
  and a full UiNode reflection round-trip of every authored style field.
- **Still not on screen.** Phase 2 renders the computed boxes (quads + borders + ADR-0149
  glyphs) through the 2D pipeline and wires `measureText` for text content nodes; Phase 3 is
  `.rss` styling; Phase 4 widgets. So nothing to screenshot yet — layout is verified purely
  in the ECS.
- Roadmap: `docs/roadmap/ui-system.md` (Phases 1a+1b done). ADR-0150. MASTER-ROADMAP 🟡.

---
