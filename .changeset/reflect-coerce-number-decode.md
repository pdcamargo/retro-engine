---
'@retro-engine/reflect': patch
---

fix(reflect): coerce + validate numbers in decodeValue

`decodeValue` for a `number` field returned the value unchanged, so a numeric
string (an editor / MCP field-set may pass `"0.15"`) flowed through to consumers
unchanged — and a string in an `f32` material uniform threw deep in the render
loop. It now coerces a numeric string to a number and throws a clear error for a
non-numeric value, so a bad value fails fast at decode rather than poisoning a
downstream GPU uniform packer.
