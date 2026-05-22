# Transform and Hierarchy

- **Created:** 2026-05-21

## Context

Every visual feature beyond the inline-coordinates triangle needs a transform: sprites, tilemaps, UI, debug viz, animation, scenes. Bevy ships `Transform` as a single Component with `translation: Vec3`, `rotation: Quat`, `scale: Vec3` — usable for 2D (z=0, Z-axis quaternion) and 3D without a separate type. We adopt that shape directly. There is no `Transform2D` intermediate; building one would just produce work to refactor away later.

Hierarchy is the second half: `Parent` and `Children` components link entities; a propagation system computes each entity's world-space `GlobalTransform` from its local `Transform` and ancestor chain. Bevy runs propagation in `PostUpdate`; we do the same. Single-threaded sequential propagation — Bevy 0.18's parallel propagation isn't a target for us.

```ts
// Approximate surface.
class Transform {
  constructor(
    public translation = Vec3.zero(),
    public rotation    = Quat.identity(),
    public scale       = Vec3.one(),
  ) {}
  static requires = [GlobalTransform];
}

class GlobalTransform { /* read-only world-space matrix or TRS, kept in sync with Transform */ }
class Parent   { constructor(public entity: Entity) {} }
class Children { constructor(public entities: Entity[]) {} }

// Spawning hierarchies (sugar over Commands).
cmd.spawn(new Transform()).withChildren((parent) => {
  parent.spawn(new Transform(/* offset */));
  parent.spawn(new Transform(/* offset */));
});

// Propagation is automatic; system runs in PostUpdate.
for (const [global] of world.query([GlobalTransform], { with: [Sprite] })) {
  /* read world-space transform during render extract */
}
```

This is the first phase in M2 where the whole stack participates end-to-end: archetype storage holds the components, queries iterate them, the schedule's `PostUpdate` stage runs propagation, Commands' `withChildren` builds hierarchies, the resource registry hosts no transform-specific resource but the prior phases must all be functional.

## Why deferred

M2 phase 7. Depends on every prior M2 phase: param protocol (phase 1), resource registry (phase 2 — pulled in transitively by other consumers, not directly here), archetype world (phase 4 — Transform is the first Required Components consumer), schedule (phase 5 — propagation runs in `PostUpdate`), Commands (phase 6 — spawn helpers wrap it). The integration risk is real; this is the M2 phase most likely to surface design gaps in the earlier phases.

## Acceptance

- `packages/engine` (or a new `packages/transform`, decided at execution) exposes `Transform`, `GlobalTransform`, `Parent`, `Children`.
- `Transform` declares `Required: [GlobalTransform]` so spawning a `Transform` auto-inserts a `GlobalTransform`.
- A propagation system runs in `PostUpdate`, reads `Transform` + `Parent`, writes `GlobalTransform`. Roots (no `Parent`) propagate identity; descendants compose ancestor transforms in order.
- `withChildren(cb)` / `addChild(entity, child)` helpers exist on the `Commands` entity builder.
- Despawning a parent despawns its `Children` recursively, or removes them from the parent — choose one and document it (recommended default: despawn recursive).
- Tests cover: spawn parent + child, move parent, child `GlobalTransform` reflects the parent's translation/rotation/scale; reparenting; despawn-parent-despawns-children; deep chains (≥3 levels) propagate correctly.
- The `apps/playground` triangle is migrated: a `Transform`-positioned triangle proves the integration. Optional: spawn two child triangles to demonstrate hierarchy visibly.
- **No `Transform2D` type, no `Position`/`Rotation`/`Scale` as separate components, no parallel propagation, no worker offload.** Single-component `Transform`, single-threaded propagation, end of story.

## Links

- Roadmap: `docs/roadmap/engine-foundations.md` (M2 umbrella, phase 7)
- Roadmap: `docs/roadmap/transform-and-hierarchy.md` (this backlog ships the base; that roadmap captures future extensions)
- Prereqs: every other M2 backlog item — this is the integration phase.
- Consumers (post-M2): sprite rendering, UI, scenes/prefabs, debug viz, animation.
- External: Bevy `Transform` / `GlobalTransform` / `Parent` / `Children` ([bevy-cheatbook](https://bevy-cheatbook.github.io/fundamentals/transforms.html))
