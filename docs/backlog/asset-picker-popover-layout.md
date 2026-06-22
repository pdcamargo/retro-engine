# Asset picker — compact popover layout

The asset picker ships with the full **modal** layout only (ADR-0110). The design handoff also specifies a compact **popover** that drops out of the inspector field it was opened from (anchored, with a caret), for quick reassignment without the full tree/preview chrome.

Build the popover as a second layout of the same picker: reuse `asset-picker-catalog.ts` filtering and the `AssetPickerState`; anchor to the `assetField`'s item rect; show search + scoped chips + grid + footer, no tree/preview. A layout toggle (or a heuristic: popover for a quick click, modal for a "browse all") selects between them.
