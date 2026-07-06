# @retro-engine/physics-core

The physics contract for Retro Engine — Avian-shaped, `2d`/`3d`-suffixed ECS
components plus a backend-agnostic `PhysicsBackend` interface. Game code authors
physics as components with no knowledge of the underlying solver; a concrete
backend (e.g. `@retro-engine/physics-rapier`) is injected at App startup.

```sh
bun add @retro-engine/physics-core @retro-engine/physics-rapier
```

```ts
import { PhysicsPlugin, RigidBody2d, Collider2d } from '@retro-engine/physics-core';
import { createRapierBackend } from '@retro-engine/physics-rapier'; // Phase 2

app.addPlugin(new PhysicsPlugin({ backend: createRapierBackend() }));

cmd.spawn(new Transform(), RigidBody2d.dynamic(), Collider2d.rectangle(0.5, 0.5));
```

`PhysicsPlugin` steps in the fixed timestep via a Sync → Step → Writeback bridge.
With no backend injected (the default `NullPhysicsBackend`), nothing simulates —
useful for headless tests and worlds that only author physics components.

See [ADR-0148](../../docs/adr/ADR-0148-physics-architecture.md). This package is
backend-agnostic; the Rapier wasm lives in `@retro-engine/physics-rapier`.
