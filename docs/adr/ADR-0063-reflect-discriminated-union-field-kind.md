# ADR-0063: Reflect discriminated-union field kind (`t.variant`)

- **Status:** Accepted
- **Date:** 2026-06-03

## Context

Reflection v1 (ADR-0060) shipped `@retro-engine/reflect` with a fixed `FieldKind` vocabulary — scalars, vectors, `color`, `array`, `tuple`, `struct`, `enum`, `entity`, `handle`, `type` — and a JSON codec that `assertNever`s any kind outside that set. There is no discriminated-union kind.

The component-registration sweep (ADR-0064) surfaced six authored fields that are discriminated unions, none of which the existing vocabulary can describe without flattening or dropping them:

- `ClearColorConfig` — `{ kind: 'default' } | { kind: 'custom'; color } | { kind: 'none' }`
- `ScalingMode` — six `{ kind }`-tagged numeric arms (`OrthographicProjection.scalingMode`)
- `SpriteImageMode` — `{ kind: 'auto' } | { kind: 'sliced'; slicer }`
- `CameraRenderTarget` / `CameraDepthTarget` — tagged unions whose non-default arms carry live GPU references (a `Surface`, `Texture`, `TextureView`)
- `SpriteAnchor` — `'center' | 'topLeft' | … | { x; y }`, a string-enum *mixed with* a struct (no shared discriminant)

ADR-0060 stays sealed. Adding a field kind is additive — it extends the vocabulary without changing any existing decision or breaking any existing schema or scene file — so it is recorded here as a new ADR rather than an edit to ADR-0060, matching how this repo treats additive codec/binding-vocabulary growth.

Research (verified, not assumed): Bevy's reflection models Rust enums as a first-class variant kind with named/struct/tuple variants and a discriminant, rather than encoding them as ad-hoc structs. The tagged-object representation here is the JSON-native analog.

## Decision

- **Add a `'variant'` `FieldKind` and a `t.variant(tag, arms, opts?)` builder.** Each arm names a field schema (an empty schema `{}` is a payload-less arm). The builder carries the discriminant property name (`variantTag`), the arm schemas (`variants`), and a `variantStringArms` flag.
- **Default (tagged) mode** — every arm is an object carrying `tag`. Encodes as `{ [tag]: armName, ...payload }`; decodes back to the same shape. The inferred type is the tagged discriminated union `{ readonly [tag]: K } & InferStruct<arm>` over the arms. This covers `ClearColorConfig`, `ScalingMode`, `SpriteImageMode`, and the data arms of the camera target unions.
- **String-or-struct mode** (`{ stringArms: true }`) — payload-less arms serialize as bare string literals and the single arm carrying a payload is an untagged object, dispatched at the codec boundary by runtime type (`string` vs object). The inferred type is `armName | InferStruct<payloadArm>`. This is exactly `SpriteAnchor`'s "named preset or custom value" shape.
- **An arm whose discriminant names no schema arm is omitted on encode**, so the field falls back to its constructor default on load. This is the deliberate home for union arms that carry runtime-only references with no persistent identity: a `Camera` registers `target` with only the `{ primary }` arm and `depthTarget` with only `{ auto } | { none }`, so a camera rendering to an offscreen GPU texture round-trips its target back to `primary` rather than serializing a dead handle.
- **No new mechanism beyond the kind.** Encode/decode reuse the existing `encodeFields` / `applyFields` recursion, so a variant arm may itself contain handles, nested `t.type` values, structs, or further variants.

## Consequences

- The six authored union fields round-trip; the registration sweep (ADR-0064) can close the component gap including unions instead of dropping union-typed authored state.
- One new `FieldKind` joins the codec and the inspector's eventual widget vocabulary. The encode/decode branches and the inference helpers (`TaggedUnion`, `StringOrStructUnion`) are the maintenance surface.
- The only union state that intentionally does **not** round-trip is a genuine live GPU reference (an offscreen `CameraRenderTarget`, a manual `CameraDepthTarget` view) — classified runtime-only and restored to the default arm. A custom depth *format* on the `auto` arm is likewise not persisted (it reverts to the engine default); this is a deliberate, minor omission, not a gap.
- Existing schemas and scene files are unaffected — the kind is purely additive.
- No benchmark: the variant codec runs at save/load, not per-frame and not on a content-cost-scaling path (CLAUDE.md §11).

## Implementation

- `packages/reflect/src/field-type.ts` — `t.variant`; the `'variant'` `FieldKind`; the `variantTag` / `variants` / `variantStringArms` `FieldState`+`FieldType` members; the `TaggedUnion` / `StringOrStructUnion` inference helpers
- `packages/reflect/src/codec.ts` — the `'variant'` case in `encodeValue` / `decodeValue` and the `untaggedArm` helper
- `packages/reflect/src/codec.test.ts` — tagged-arm, payload-less-arm, string-or-struct, and runtime-arm-omission round-trips
