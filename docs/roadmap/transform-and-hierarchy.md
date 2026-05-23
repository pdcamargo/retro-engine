# Transform and Hierarchy (extensions beyond M2 baseline)

- **Created:** 2026-05-21
- **Status:** Future direction (sketch)

## Goal

The M2 backlog item `transform-hierarchy.md` ships the baseline: `Transform` (one component, `Vec3` translation + `Quat` rotation + `Vec3` scale), `GlobalTransform`, `Parent`, `Children`, and a propagation system in `PostUpdate`. That's enough for sprites, UI placement, and basic hierarchies.

This roadmap captures everything *beyond* the baseline — extensions we know we'll want but deliberately defer until they have a real consumer asking for them. The point is to keep ideas on paper without bloating the foundations milestone.

## Phases

Each phase is a sketch. Promote to a backlog item when a real use case appears.

1. **2D Z-ordering** — explicit `ZOrder` component or layer index for sprite/UI sorting independent of `Transform.translation.z`. Today's "use z = render order" works but conflates spatial and visual depth.
2. **Hierarchy ergonomics** — `world.entity(e).parent()` / `.children()` query helpers; `Parent`-aware `query.related()` traversal; safe reparenting (`cmd.entity(child).setParent(newParent)` handles old-parent's `Children` removal atomically).
3. **Transform helpers** — `Transform.fromTranslation(...)`, `lookAt`, `fromXYZ`, `localToWorld`, `inverseTransformPoint`, etc. Common conveniences that don't belong in the core component.
4. **GlobalTransform caching strategy** — today's design recomputes propagation every frame for every entity with `Transform + Parent`. Investigate dirty-flag or generation-based skipping if profiling justifies it.
5. **Decoupled local-vs-world cache** — `GlobalTransform` stored as a precomputed Mat4 vs as a TRS triple. Trade-off: matrix is faster to consume in rendering, TRS is easier to interpolate. Default to matrix; expose both.
6. **Animation hooks** — `Transform` is the natural target for sprite animation, tween systems, skeletal animation. None of those live here, but this roadmap is the right place to plan how they interact with hierarchy propagation (run animation *before* propagation in `Update`, or after?).
7. **3D-specific extras** — once 3D gameplay appears: skew matrices, non-uniform scale handling, double-precision world transforms for very large worlds. Speculative — not in the near term.

## Open questions

- Z-ordering: separate component, or a property on the relevant render component (e.g., `Sprite.layer`)?
- Despawn-parent semantics: always-cascade is the default since ADR-0014. The remaining open question is the escape hatch — a first-class `detachChildren()` / "drop the subtree before I despawn the root" surface for the rarer "orphan the children on purpose" use case. Today's escape hatch is `cmd.entity(parent).removeChild(child)` per child, which is verbose for wide subtrees.
- Mat4-vs-TRS storage for `GlobalTransform`: implementation detail or public choice?
- Does `Transform` need a builder API, or are object-literal constructors enough?

## Links

- M2 baseline: `docs/backlog/transform-hierarchy.md`
- ADR-0001 (composition-only — Transform is a component, hierarchy is data on entities, no scene-graph class hierarchy)
- Consumers: sprite rendering, UI, scenes/prefabs, animation, debug viz.
- External: Bevy `Transform` + `GlobalTransform` + hierarchy ([bevy-cheatbook](https://bevy-cheatbook.github.io/fundamentals/transforms.html))
