# Event-driven cull + prepares — follow-ups (post ADR-0040)

ADR-0040 landed the change-gated cull and event-driven retained prepares. These
are the deferred items that remain.

## 1. Headed re-trace verification (blocking the items below)

Profile `?mode=stress&size=large&retained=1` in a **headed** browser DevTools CPU
profile (headless FPS is not comparable — it's present-bound at full res). Expect:

- `forEachEntry` / iteration drops sharply vs the ADR-0039 baseline.
- Static-scene CPU is roughly flat regardless of entity count.
- Sanity: a moving camera + a spawn/despawn burst still render correctly (full-pass
  + delta paths).

Record the new FPS / self-time numbers. Until this is confirmed, the change is not
"done" (CLAUDE.md §3) and items 2–3 stay parked.

## 2. Flip the `retained` default to `true` and retire the legacy path

Deferred since ADR-0039 and unchanged by ADR-0040. Once the re-trace confirms the
event-driven path is a strict win:

- Flip `{ retained }` default to `true` on `SpritePlugin` / `MaterialPlugin` /
  `Material2dPlugin`.
- Retire the legacy full-repack prepare/queue paths (`prepareSprites`,
  `queueMaterials`, the `SpriteInstanceBuffer` / `SpritePreparedBatches` resources)
  — currently kept as the fallback and the byte-exact parity reference. Removing
  them also removes the parity tests' reference path, so decide whether to keep a
  frozen reference fixture or trust the bench + visual.

## 3. Asset-unload-while-visible detection

ADR-0040 documented limitation: an entity that stays visible while its mesh/image
is *evicted* from `RenderMeshes` / `RenderImages` is not re-detected (it is neither
a `Changed` event on the entity nor a main-world component removal). Assets are
add-only in practice today. If eviction-while-visible is ever needed, have the
image/material/mesh prepares publish a per-frame dirty-handle set that the
membership step intersects with current members, dropping/parking the affected
entities. Add a parity test that evicts a handle mid-run.

## 4. Profile the next wall

If the re-trace shows iteration is gone, the residual per-frame cost is render-graph
dispatch + draw emission + command encoding (the event-driven bench's floor was
there, not in the cull/prepare). That is the next lever once this is merged.
