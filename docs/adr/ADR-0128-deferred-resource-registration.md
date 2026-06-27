# ADR-0128: Deferred resource registration via `App.whenResource`

- **Status:** Accepted
- **Date:** 2026-06-27

## Context

A plugin sometimes needs to register something against a resource that a
*different* plugin inserts — the canonical case being a loader registered on the
`AssetServer`, which `AssetPlugin` inserts. Until now such code guarded on the
resource already being present at `build()` time:

```ts
const server = app.getResource(AssetServer);
if (server !== undefined) { server.registerLoader(...); }
```

That guard is silently order-dependent, and the order is not under the plugin's
control. `CorePlugin` is added unconditionally in the `App` constructor, and it
adds `AnimationPlugin`; the studio (and any host) adds `AssetPlugin` later, in
its project-runtime install. So `AnimationPlugin` always builds *before* the
`AssetServer` exists, the guard is always false, and its `.ranim` / `.ranimctrl`
/ `.ramask` loaders and `Animation` sub-asset store were never registered — in
the studio *or* anywhere else. The sub-asset half had been worked around by
re-registering it from `GltfPlugin.build()` (which does build with the server
present).

`finish()` (the plugin late-wiring hook) cannot fix this: it runs inside the
first `advanceFrame`, which in the studio happens *after* the project scene is
loaded — and scene load resolves asset GUIDs eagerly, so the loaders must exist
*before* it. Reordering `CorePlugin` is not an option without rewriting the `App`
constructor contract every consumer depends on. The registration must instead
fire at the deterministic moment the resource appears, whenever that is.

## Decision

Add a general lifecycle primitive `App.whenResource(ctor, callback)`:

- If a resource of type `ctor` is already registered, the callback runs
  immediately with it.
- Otherwise the callback is queued and runs the first time
  `App.insertResource` registers that type. It fires at most once per
  registration and is dropped after firing (a later replace does not re-run it).

This is the sanctioned way for a plugin to register against a resource provided
by another plugin, regardless of the order the two are added. A plugin no longer
guards on a resource being present at `build()` time; it wires the dependency
through `whenResource` from its own `build()` and lets the App fire it at the
right moment.

`AnimationPlugin` registers its loaders and the `Animation` sub-asset store
through `whenResource(AssetServer, ...)`. The `GltfPlugin` sub-asset-store
workaround (documented in ADR-0127's Implementation section, which remains frozen
as historical record) is removed — registration belongs to `AnimationPlugin`
again, per ADR-0126.

## Consequences

- Standalone animation assets load in any host, and the sub-asset path runs
  through `AnimationPlugin`'s own registration rather than a foreign plugin's
  workaround. The fix is order-independent, so it cannot silently regress if
  plugin order changes again.
- `insertResource` gains one map lookup per fresh insert (setup-time, not on the
  per-frame path). `whenResource` callbacks fire once at setup.
- A new public API surface (`App.whenResource`) that other plugins can adopt for
  the same class of cross-plugin dependency. The trade-off accepted: a callback
  that defers can run "later than the call site," so callers must not assume the
  resource is present synchronously after `whenResource` returns.

## Implementation

- `packages/engine/src/index.ts` — `App.whenResource`, the `resourceWaiters`
  queue, and the waiter-firing branch in `App.insertResource`.
- `packages/engine/src/animation/animation-plugin.ts` — defers loader and
  sub-asset-store registration via `whenResource(AssetServer, ...)`.
- `packages/gltf/src/gltf-plugin.ts` — removes the `registerSubAssetStore('Animation', …)`
  workaround.
- `packages/engine/src/app.whenResource.test.ts`,
  `packages/engine/src/animation/animation-plugin.test.ts` — coverage for the
  primitive and the order-independent registration.
