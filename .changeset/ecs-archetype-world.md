---
"@retro-engine/ecs": minor
---

Replace the day-1 stub `World` with archetype-graph storage: each unique component set is an archetype with parallel columns of component data plus a side-by-side last-mutation tick column. Adds:

- Multi-component `world.query([A, B])` returning an iterable `Query` handle with `.single()`, `.first()`, `.count()`.
- Filter shapes: `with`, `without`, `has`. `has` appends one boolean per entry to each yielded row in declaration order.
- Required Components — a component class declares `static requires: ComponentType[]`, and spawning resolves the dependency graph transitively (with cycle detection and a default-constructibility check).
- `Disabled` marker — entities carrying `Disabled` are excluded from queries by default; pass `{ with: [Disabled] }` to opt back in.
- `world.entity(e)` builder returning a chainable `EntityRef` with `.insert(...)`, `.remove(...)`, `.get(...)`, `.has(...)`, `.despawn()`.
- Variadic `world.spawn(...)` accepting individual components or a single array bundle.
- Per-column tick storage so the future change-detection filters (`Changed<T>` / `Added<T>`) can land without re-storaging.

Breaking: `ComponentType<T>` no longer accepts `symbol` — components are identified by their class constructor exclusively. Migrate symbol-based markers to empty classes (`class Disabled {}`).
