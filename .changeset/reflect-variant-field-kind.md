---
'@retro-engine/reflect': minor
---

feat(reflect): discriminated-union `t.variant` field kind — ADR-0063

The codec's `FieldKind` vocabulary had no way to describe a discriminated union, so authored fields like a tagged `{ kind }` config or a "named-preset-or-custom" value could not round-trip. `t.variant(tag, arms, opts?)` adds one:

- **Tagged mode** (default) — each arm names a field schema and carries the discriminant `tag`; encodes as `{ [tag]: armName, ...payload }`. Infers the tagged discriminated union.
- **String-or-struct mode** (`{ stringArms: true }`) — payload-less arms serialize as bare strings and the single arm with a payload is an untagged object, for `'center' | … | { x; y }`-shaped unions.
- An arm whose discriminant names no schema arm is omitted on encode, restoring the field's constructor default on load — the home for union arms that carry runtime-only references.

Additive: existing schemas and scene files are unaffected. ADR-0060 stays sealed.
