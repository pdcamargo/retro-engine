# Asset picker — multi-select for array-of-handle fields

The picker is single-select (ADR-0110). The design handoff also specifies a multi-select mode (tile checkboxes, a selection strip, "Assign N") for array properties like animation frames or texture arrays.

Not wired today because **no engine component has a `t.array(t.handle(...))` field** — there is nothing to assign to. When one lands, extend the picker: the `array` kind renderer opens the picker in multi mode, the `AssetPickerState` selection becomes a set, and the commit closure writes the resolved handle array. The state/commit shapes were chosen so this is an additive change, not a rewrite.
