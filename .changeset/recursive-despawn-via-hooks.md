---
'@retro-engine/engine': minor
---

feat(engine): cascade despawn via onRemove(Children/Parent) hooks (ADR-0014)

`cmd.entity(e).despawn()` now cascades through `Children` and detaches the dying entity from its parent's `Children` list. The cascade and detach behaviours are driven by `onRemove` component hooks registered in `CorePlugin` — the first consumer of the hook surface shipped in ADR-0013.

**Behavioural change (public surface):**

- `cmd.despawn(parent)` despawns every descendant reachable through `Children`. Previously (per ADR-0010 §3) plain despawn was single-entity; cascades required `.despawnRecursive()`.
- `cmd.despawn(child)` removes the child from its parent's `Children.entities` list. Previously this only happened via `.despawnRecursive()`.
- Opt out of cascade by detaching with `cmd.entity(parent).removeChild(child)` before despawning, or by calling `world.despawn(e)` directly (raw world calls still bypass hooks per ADR-0013).

**API surface:**

- `EntityCommands.despawnRecursive()` survives as an alias for `.despawn()`. The call-site name remains for intent signalling; both share one code path.
- `CommandOp` loses the `'despawnSubtree'` variant. Internal-only; no consumer touches `CommandOp` directly.

**ADR provenance:**

- Seals ADR-0014.
- Supersedes ADR-0010 §3 (despawn semantics) and §7 (`despawnRecursive` mechanics). The rest of ADR-0010 (package boundary, propagation strategy, `cmd.spawn` return type, etc.) stays.
- Consumes the hook surface from ADR-0013 §11/§16 as planned — no re-opening of ADR-0013.
