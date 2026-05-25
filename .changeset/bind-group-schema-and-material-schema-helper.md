---
'@retro-engine/engine': minor
---

docs(engine): seal ADR-0027 — TS-side AsBindGroup equivalent (class-static schema + `MaterialSchema` helper)

Architectural shape decision recorded in `docs/adr/ADR-0027-bind-group-schema-and-material-schema-helper.md`. Materials declare their bind-group layout as `static bindGroup = MaterialSchema(Self, [...])`. The helper closes the rename-safety gap that a raw `as const satisfies BindGroupSchema<M>` would leave open — TypeScript can only check `fieldKey: keyof M & string` when the helper binds the class reference through a generic parameter.

Rejected alternatives:

- **TC39 Stage-3 decorators** — `tsconfig.base.json` does not enable `experimentalDecorators`; the decorator runtime is still settling. Lands when a second consumer also wants the syntax.
- **Registry / builder pattern** — does not deliver compile-time rename safety; less consistent with the engine's existing class-static metadata convention (`Transform.requires`, component lifecycle hooks, `ShaderRegistry`).
- **WGSL reflection** — the Phase 4 preprocessor is text-only; no AST. Lands with a WGSL parser ADR.

Implementation ships under `feat(engine): material system, Core3d phase trio, per-camera depth automation`.
