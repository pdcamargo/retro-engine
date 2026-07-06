# @retro-engine/physics-rapier

The [Rapier](https://rapier.rs/) backend for Retro Engine physics, over
`@dimforge/rapier2d-compat`. Implements the `PhysicsBackend` contract from
`@retro-engine/physics-core`; inject it into `PhysicsPlugin`:

```ts
import { PhysicsPlugin } from '@retro-engine/physics-core';
import { createRapierBackend } from '@retro-engine/physics-rapier';

app.addPlugin(new PhysicsPlugin({ backend: createRapierBackend() }));
```

The wasm loads asynchronously on `init()`; the physics bridge skips stepping
until the backend reports `ready()`. This package handles **2D** bodies today;
3D (via `rapier3d-compat`) is a later phase.

See [ADR-0148](../../docs/adr/ADR-0148-physics-architecture.md).
