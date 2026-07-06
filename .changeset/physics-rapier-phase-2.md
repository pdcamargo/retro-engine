---
'@retro-engine/physics-rapier': minor
---

feat(physics): Phase 2 — Rapier 2D backend (`@retro-engine/physics-rapier`)

Per ADR-0148, the concrete physics backend over `@dimforge/rapier2d-compat`. Inject it into `PhysicsPlugin` to get real 2D rigid-body dynamics:

```ts
import { PhysicsPlugin } from '@retro-engine/physics-core';
import { createRapierBackend } from '@retro-engine/physics-rapier';
app.addPlugin(new PhysicsPlugin({ backend: createRapierBackend() }));
```

**What it does:** implements the full `PhysicsBackend` contract for 2D — async wasm `init()`/`ready()` gate, entity↔body maps, `upsertBody` (dynamic/kinematic/static bodies with ball/cuboid/capsule colliders, restitution/friction/sensor), per-frame gravity, gravity-scale, external force, and kinematic targets, `step` at the fixed-timestep dt, `readBody` writeback, `removeBody`, `raycast`, and collision start/stop event drain. 3D snapshots are ignored (3D via `rapier3d-compat` is Phase 3).

Verified by a **deterministic headless test** (a dynamic box falls under gravity and lands on a static floor; gravityScale 0 floats; removeBody drops the body). Playground `?mode=physics` demos boxes falling and stacking, with Space to drop more. A kinematic character controller, joints, 3D, and ECS-surfaced collision events are Phase 3.
