---
'@retro-engine/reflect': patch
'@retro-engine/engine': patch
---

fix(engine): keep entity references out of derived-subtree overrides (fixes dead skinning on scene reload)

A glTF instance's bones are *derived* entities — rebuilt with fresh ids each time the model
re-instantiates on load. The derived-override system (which persists edits to instanced subtrees)
assumed glTF node components carry no entity fields, but GPU skinning later added `Skeleton` whose
`joints` are an entity array into that subtree. The result: the override baseline encoded the joints
as `-1`, the save-time diff saw the live ids as a change and persisted `Skeleton` as a phantom
override, and on load that override decoded against an empty entity remap — zeroing every joint. The
skinned mesh then stayed in its bind/T-pose no matter what drove the bones.

The fix treats entity references as unrepresentable in derived overrides (their targets are rebuilt,
so the ids can never round-trip):

- **`@retro-engine/reflect`** — new `schemaHasEntityField` / `fieldHasEntityRef` walk a schema for any
  entity-typed field (through arrays, tuples, structs, variants, and nested registered types).
- **Capture** (`serialize.ts`) — a derived entity's entity-bearing components are no longer diffed or
  flagged for removal; they are left to the mount's provider to rebuild, so nothing phantom-persists.
- **Apply** (`composition-apply.ts`) — a persisted override targeting an entity-bearing component is
  skipped, so scenes saved before this fix self-heal: the re-instantiated `Skeleton` stands instead of
  being clobbered with zeroed joints.
