---
'@retro-engine/engine': minor
---

feat(engine): controller-owned animation layers + animation assets to YAML

Per ADR-0141 and ADR-0142. An `AnimationController` now authors its own layer stack,
and the three animation asset formats move to YAML to match scenes/prefabs (ADR-0089).

**New public surface:**

- `ControllerLayer` — an authored layer on the controller (`name`, `weight`,
  `blend: 'override' | 'additive'`, optional `mask`, and a clip-or-controller
  `source`), structurally an `AnimationLayer` plus a display name.
- `AnimationController.layers: ControllerLayer[]` — layers composited over the base
  machine (the controller's own `parameters`/`states`/`transitions` are layer 0, full
  body at weight 1). Empty for a single-layer controller.

**Behaviour changes:**

- A controller player whose controller declares `layers` composes as a layer stack
  (base machine as layer 0, authored layers above), driven through the shared layered
  path (`driveStack`) with per-layer masks and override/additive blending. A controller
  with no layers keeps its existing single-machine path. `AnimationLayers` is unchanged
  and remains the runtime evaluation primitive + the per-entity composition surface.
- `.ranimctrl` bumps to wire-format version 3 (adds `layers`) and encodes as YAML.
  Consistent with the ADR-0140 v2 bump this is a clean break — a v2 payload fails the
  version guard with a clear error. `createAnimationControllerImporter` /
  `createAnimationControllerSerializer` now take the controller and mask stores (to
  resolve layer references by GUID) alongside the clip store.
- `.ranim` and `.ramask` encode as YAML (no version change). YAML is a JSON superset,
  so existing JSON-encoded clips/masks still load and are re-emitted as YAML on save.
