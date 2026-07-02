# ADR-0141: Controller-owned animation layers

- **Status:** Accepted
- **Date:** 2026-07-01

## Context

Two independent representations of "layered animation" exist in the engine, at
different altitudes:

- **`AnimationController`** (ADR-0119, ADR-0140) is a reusable, entity-agnostic
  asset: parameters, states, condition-driven transitions, and nested blend-tree
  motions. It has **no** notion of layers — it is a single state machine.
- **`AnimationLayers`** is a per-entity runtime component: an ordered stack of
  `AnimationLayer`s, each with a `weight`, a `blend` mode (`override`/`additive`),
  an optional `mask`, and a `source` that is either a clip or a whole controller.
  It is authored/composed per character instance and evaluated by `layer-blend.ts`.

The Animation Controller editor (the Unity-Animator equivalent) authors layers as
part of *the controller* — a "Layers" tab listing an ordered stack, each layer with
a weight, blend mode, mask, and a clip-or-controller source. That is design intent
(and Unity parity): a controller ships with its layer stack so it is reusable across
many character instances without re-authoring the stack on each entity.

The controller had nowhere to store that. `AnimationLayers` is the right *runtime
evaluation* primitive but the wrong *authoring home* — it lives on the entity, not
the shareable asset.

## Decision

**The `AnimationController` asset gains an authored `layers` field.** The controller's
own state machine (`parameters`/`states`/`transitions`) is the **base layer (index 0)**,
always full-body at weight 1. `layers` holds the *additional* layers stacked on top,
each a `ControllerLayer`:

```
ControllerLayer = {
  name: string;
  weight: number;                         // 0…1
  blend: 'override' | 'additive';
  mask?: Handle<AvatarMask>;              // absent = full body
  source: LayerSource;                    // reuse the existing shape
}
```

`source` reuses `LayerSource` from `animation-layers.ts` unchanged — a layer plays a
clip or a whole controller, which already matches the design.

**`AnimationLayers` is not deleted.** It remains the runtime evaluation primitive and
the surface for per-entity, code-composed layer stacks. When a player binds a
controller that declares `layers`, the animation system **materializes/drives** the
runtime `AnimationLayers` from the controller's authored stack (base machine as layer
0, authored layers above). The two representations stay distinct: `ControllerLayer` is
authored design-time data on the asset; `AnimationLayers` is the per-entity runtime
composition that consumes it.

**The `.ranimctrl` wire format bumps to version 3.** `layers` is written after
`transitions`; mask and controller references serialize by GUID (like clip handles).
Consistent with ADR-0140, this is a **clean break with no migration path** (pre-0.1.0,
CLAUDE.md §6): the version guard rejects a v2 payload with a clear error rather than
mis-parsing it.

The authored `ControllerLayer` fields are a **serialized, reflected** component of the
controller asset (CLAUDE.md §13); the transient per-layer runtime
(`AnimationLayerRuntimes`, `ReferencePoses`) stays derived and unserialized.

## Consequences

- A controller is now self-contained: its layer stack travels with the asset and is
  reusable across instances, matching the editor's Layers tab and Unity's model.
- The runtime keeps one evaluation path (`layer-blend.ts` over `AnimationLayers`); the
  controller-owned stack is a new *source* for it, not a second evaluator.
- Two places can describe a layer stack (the controller asset and a hand-built
  `AnimationLayers` component). The binding step defines precedence: a controller's
  authored `layers` drives the materialized runtime stack; a manually attached
  `AnimationLayers` remains valid for entities that compose layers in code.
- Old `.ranimctrl` (v2) files break, as with the ADR-0140 v2 bump. Accepted during
  scaffold.

## Implementation

- `packages/engine/src/animation/animation-controller.ts` — `ControllerLayer`,
  `AnimationController.layers`.
- `packages/engine/src/animation/animation-layers.ts` — `LayerSource` (reused; no
  change), `AnimationLayer` shape referenced by `ControllerLayer`.
- `packages/engine/src/animation/animation-controller-asset.ts` — `SerializedLayer`/
  `SerializedLayerSource`, `encodeLayer`/`decodeLayer`, widened serializer/importer
  (now resolve controller + mask GUIDs through their stores),
  `ANIMATION_CONTROLLER_FORMAT_VERSION` (bumped to 3). The controller is an asset
  serialized by this codec — its layers need no separate reflection schema.
- `packages/engine/src/animation/animation-system.ts` — `driveStack` (shared layered
  driver); a controller player whose controller declares `layers` composes as
  `[base-machine-as-controller-layer, ...controller.layers]` through it.
- `packages/engine/src/animation/animation-plugin.ts` — wires the widened serializer/
  importer with the controller + mask stores.
