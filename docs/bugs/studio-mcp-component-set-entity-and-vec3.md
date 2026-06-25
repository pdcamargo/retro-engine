# Studio MCP `component.set` corrupts entity-ref and vec3 fields

- **Reported:** 2026-06-25
- **Severity:** Medium — single-field edits through the MCP silently write the wrong
  value for two common field kinds; `studio_eval` and the multi-field add path are
  unaffected, so it is a workaround-able but easy-to-miss correctness bug.
- **Status:** Open. Reproduced live; root cause not yet confirmed.

## Symptom

Using the editor MCP `component.set` (one top-level field at a time) on a live
component mangles two field kinds:

1. **Entity-reference fields become strings.** Setting `TwoBoneIK.pole` to the
   integer `80` stored `"80"` (a string). The runtime then reads it as a string
   entity id; `world.getComponent("80", …)` misses, so the field behaves as
   unset (the IK solver saw no pole and ignored it).
2. **`vec3` fields become an empty array.** Setting `Transform.translation` to
   `[50, 110, 20]` stored `[]` (length 0). Because the live value is a
   `Float32Array`, later in-place index writes (`t.translation[0] = …`) are
   silently dropped (out-of-bounds on a zero-length typed array), and propagation
   composes a garbage world matrix (translation reads as `undefined`/`NaN`).

The multi-field paths (`entity.spawn` / `component.add` with a `data` object,
which go through `decodeComponent`) store the **same values correctly** — e.g.
`component.add TwoBoneIK { target: 79 }` kept `79` as an integer. Only the
single-field `component.set` path is affected.

## Reproduce

1. Connect the studio MCP, open a scene with any entity that has a `Transform`.
2. `component.set { entity, type: 'Transform', field: 'translation', value: [1,2,3] }`
   → read it back with `entity.get`; `translation` is `[]`.
3. On a component with an entity-ref field (e.g. `TwoBoneIK.pole`):
   `component.set { …, field: 'pole', value: 80 }` → `entity.get` shows `"80"`.

## Suspected location

- `packages/editor-mcp/src/commands/component.ts` — the `component.set` handler:
  `decodeFieldValue(ctx, ft, record.value)` then `ctx.history.commit(…, next)`.
- `packages/editor-mcp/src/reflect-json.ts` — `decodeFieldValue` → `decodeValue`
  (and `decodeEnvFor.entity`, which is an identity cast `(id) => id`, so a string
  `value` stays a string — the entity case likely needs `Number(id)`).
- The MCP arg transport may be delivering `value` as a JSON string for the
  entity case; the vec3-becomes-`[]` case points at the single-value decode (or
  the `history.commit` apply) not reconstructing a `Float32Array` of the right
  length the way `decodeComponent` does for the whole-object path.

Likely fix: route `component.set` through the same per-field decode that
`decodeComponent` uses for the object path (so vec3 → `Float32Array(3)` and
entity → coerced number), rather than a separate single-value path.

## Workaround

Drive single-field edits through `studio_eval` (reassign the field on the live
component, then `world.markChanged(entity, Ctor)`), or set fields via the
multi-field `component.add` / `entity.spawn` `data` object. The Phase-4 IK demo
used `studio_eval` for exactly this reason.

## Affected files

- `packages/editor-mcp/src/commands/component.ts` — `component.set`.
- `packages/editor-mcp/src/reflect-json.ts` — `decodeFieldValue`, `decodeEnvFor`.
- (verify against) `@retro-engine/reflect` `decodeValue` single-value handling for
  `vec3`/`entity` vs the `decodeComponent` object path.
