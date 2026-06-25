# Inspector transform fields round small values to `0.0`

- **Reported:** 2026-06-24
- **Severity:** Medium

## Repro

1. Instantiate a glTF/GLB whose root node carries a small uniform scale (e.g. a Blender FBX→glTF export where the cm→m unit factor lands on the `Armature` node as `0.00999…`).
2. Select the instantiated node entity in the studio and look at its `Transform` → Scale fields in the inspector.

## Expected

The field shows enough precision to distinguish a small non-zero scale (`0.01`) from zero — or at least does not display a non-zero value as `0`.

## Actual

The scale reads `0.0  0.0  0.0`. The stored value is actually `0.01` per axis; the inspector renders transform components at one-decimal precision (observed: translations display as `26.7` / `35.7`, scale as `1.0`), so any magnitude `< 0.05` rounds to `0.0`. This is purely a display artifact — the component data is intact and propagates correctly — but it reads as "the importer spawned the entity at scale zero," which sent a real debugging session down the wrong path.

## Notes

Display-side only; the reflected/serialized value is correct. The field formatting lives in the inspector field-rendering path (`apps/studio/src/panels-inspector.ts` and the numeric field widget it calls). The exact formatter line was not pinned down during investigation — confirm whether it's a fixed `%.1f`/`toFixed(1)` and widen it (more significant digits, or an adaptive format that never collapses a non-zero to `0`). Compare `panels-history.ts:60` and `composer-echo.ts:27`, which already use 2–3 digits.
