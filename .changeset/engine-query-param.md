---
"@retro-engine/engine": minor
---

Add the `Query(types, filters?)` system param. Mirrors the `Res` / `ResMut` shape: each token is cached per `(types-order, filter-shape)` so `Query([A, B]) === Query([A, B])`, letting a future schedule planner dedup read/write sets by token identity. `with` and `without` are normalized as set-semantic; `has` preserves declaration order because it changes the yielded row shape.

```ts
class Position { constructor(public x = 0, public y = 0) {} }
class Velocity { constructor(public vx = 0, public vy = 0) {} }
app.addSystem('update', [Query([Position, Velocity])], (q) => {
  for (const [pos, vel] of q) pos.x += vel.vx;
});
```
