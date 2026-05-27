# Event-driven cull + prepares — follow-ups (post ADR-0040)

ADR-0040 landed the change-gated cull and event-driven retained prepares (on
`main`, commit `4ca7beb`).

**Verified 2026-05-26 (headed DevTools CPU profile):** the
`?mode=stress&size=large&retained=1` preset profiles at **~27 FPS** — up from the
9.7 FPS baseline and ~15–17 FPS after ADR-0039 (~2.8× over baseline). The
per-frame O(n) base walks are gone; the residual cost is render-graph draw
emission + the inherent GPU draw of all on-screen geometry. User accepted "okay
for now". The items below remain deferred.

## 1. Flip the `retained` default to `true` and retire the legacy path

Deferred since ADR-0039 and unchanged by ADR-0040. Now that the re-trace confirms
the event-driven path is a strict win:

- Flip `{ retained }` default to `true` on `SpritePlugin` / `MaterialPlugin` /
  `Material2dPlugin`.
- Retire the legacy full-repack prepare/queue paths (`prepareSprites`,
  `queueMaterials`, the `SpriteInstanceBuffer` / `SpritePreparedBatches` resources)
  — currently kept as the fallback and the byte-exact parity reference. Removing
  them also removes the parity tests' reference path, so decide whether to keep a
  frozen reference fixture or trust the bench + visual.

## 2. Asset-unload-while-visible detection

ADR-0040 documented limitation: an entity that stays visible while its mesh/image
is *evicted* from `RenderMeshes` / `RenderImages` is not re-detected (it is neither
a `Changed` event on the entity nor a main-world component removal). Assets are
add-only in practice today. If eviction-while-visible is ever needed, have the
image/material/mesh prepares publish a per-frame dirty-handle set that the
membership step intersects with current members, dropping/parking the affected
entities. Add a parity test that evicts a handle mid-run.

## 3. Profile the next wall

At ~27 FPS the cull/prepare iteration is gone; the residual per-frame cost is
render-graph dispatch + draw emission + command encoding (the event-driven bench's
floor was there, not in the cull/prepare). That is the next lever. 165 FPS on
100k-on-screen stays unreachable regardless (inherent GPU draw floor) — the win is
headroom and flat CPU vs entity count.
