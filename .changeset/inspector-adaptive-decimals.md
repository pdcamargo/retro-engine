---
'@retro-engine/editor-sdk': patch
---

fix(editor-sdk): number fields never render a small non-zero value as `0`

The inspector's drag/number widget formatted at a fixed step-derived precision
(one decimal by default), so a small magnitude like a cm→m scale of `0.01`
displayed as `"0.0"` and read as zero — a real debugging trap (the value was
intact; only the display collapsed). `dragNumber` now derives its decimals from
the value via `adaptiveDecimals`: zero and magnitudes ≥ 1 keep the base
precision, while a small non-zero magnitude widens to its first significant
place (+1), capped at 6 decimals so large values stay compact.
