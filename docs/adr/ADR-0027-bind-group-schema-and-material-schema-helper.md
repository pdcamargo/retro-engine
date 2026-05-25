# ADR-0027: Bind-group schema declaration — class-static + `MaterialSchema` helper

- **Status:** Accepted
- **Date:** 2026-05-24

## Context

Bevy's `Material` trait pairs with a `#[derive(AsBindGroup)]` macro: the derive reads `#[uniform(N)]`, `#[texture(N)]`, `#[sampler(N)]`, `#[storage(N)]`, `#[bind_group_data]` attributes on struct fields and synthesises both the `BindGroupLayout` and a `prepare_bind_group` implementation at compile time. The pattern survives in Bevy because Rust has stable derive macros; the user writes one struct, the compiler writes the layout and the binding boilerplate.

TypeScript has no derive macros. Phase 7's `Material` system needs an equivalent — a way for a material class to declare, in one place, both the GPU bind-group layout and how to lift instance field values into a `BindGroup`. The renderer-roadmap's Phase 7 entry calls this out as "the TS AsBindGroup equivalent is the architectural decision worth recording — decorator-driven, registry-driven, or class-static schema."

This ADR settles that decision.

The candidates considered:

- **(A) TC39 stage-3 decorators** — `@uniform(0) color: Vec4`. Closest visual match to the Rust derive macro. Requires `experimentalDecorators` in `tsconfig.base.json`; the codebase does not currently set it. The decorator runtime semantics are still settling at TC39 stage 3 / TypeScript 5 — refactors to the spec ripple across every decorated class.
- **(B) Class-static schema** — `static bindGroup = [...]` declared on the class. The dominant metadata pattern already in this codebase: `Transform.requires`, `ComponentHookRegistry` `static onAdd` / `onRemove`, `ShaderRegistry` singleton constants. Visible at class-definition time, discoverable by the plugin via reflection.
- **(C) Registry / builder** — `registerMaterial(StandardMaterial, b => b.uniform(0, 'fragment').texture(1).sampler(2))`. Most JS-idiomatic, mirrors `PluginGroupBuilder`. The schema lives outside the class, in a function-of-class.
- **(D) WGSL reflection** — parse the material's WGSL and discover bindings from `@group(N) @binding(M) var ...` declarations. Would make the shader the single source of truth. Requires a WGSL parser. The Phase 4 preprocessor (ADR-0022) is text-only; there is no WGSL AST in the codebase.

The decision drivers, in order:

1. **Codebase consistency.** The metadata pattern that already exists should be the one that wins, unless there is a compelling reason to invent a new one.
2. **Refactor safety.** Renaming a material's field should be a one-touch operation. Either the rename is type-checked (compile error on stale references) or it isn't (silent runtime breakage).
3. **No new tsconfig flags.** The decorator runtime is still moving; opting in now lights up every future decorator-aware tool with semantics we may have to migrate later. Defer until a second consumer also wants decorators.
4. **No new tooling.** A WGSL parser would be useful but is its own ADR with its own consumer story.

Out of scope for this ADR (each documented in §"Not yet done" with its trigger):

- **TC39 decorators for system params, components, or anything else.** Lands when a second consumer also wants the syntax, at which point the cost of enabling the flag is justified.
- **A WGSL parser** — for reflection, hot-reload error mapping, or shader linting. Lands with its first concrete consumer.

## Decision

1. **Material bind-group layouts are declared as a class-static `bindGroup` schema.** The schema is an array of `BindGroupEntry<M>` entries describing each binding slot. Each entry references the material's instance fields by string key, with the key type-checked against `keyof M`. Implementation lives in `packages/engine/src/material/bind-group-schema.ts`.

2. **The schema is constructed via the `MaterialSchema(ClassRef, [...])` helper.** Raw `as const satisfies BindGroupSchema` does *not* deliver rename safety — the string `'baseColor'` is checked against the schema's structure, not against `keyof StandardMaterial`. The helper closes the gap by threading the class reference through a generic parameter:

   ```ts
   export function MaterialSchema<C extends abstract new (...a: any[]) => any>(
     _classRef: C,
     schema: readonly BindGroupEntry<InstanceType<C>>[],
   ): readonly BindGroupEntry<InstanceType<C>>[] {
     return schema;
   }
   ```

   The schema's `fieldKey` is typed `keyof InstanceType<C> & string`. Renaming `StandardMaterial.baseColor → tint` breaks every schema entry that referenced `'baseColor'` at compile time. The `_classRef` parameter is unused at runtime — it exists solely to bind the generic parameter.

3. **Acceptance criterion: rename safety requires the helper.** A schema declared as a raw object literal — `static bindGroup = [{ kind: 'uniform', binding: 0, ... }] as const satisfies BindGroupSchema` — will *not* produce a compile error when a referenced field is renamed. The ADR explicitly documents this as a sharp edge; the helper is the documented path; the TSDoc on `MaterialSchema` calls it out.

4. **`BindGroupEntry<M>` is a discriminated union** keyed by `kind`. Phase 7 ships these kinds:

   ```ts
   type BindGroupEntry<M> =
     | { kind: 'uniform';
         binding: number;
         visibility: BindingVisibility;
         fields: readonly UniformField<M>[]; }
     | { kind: 'texture';
         binding: number;
         visibility: BindingVisibility;
         sampleType?: TextureSampleType;
         viewDimension?: TextureViewDimension;
         fieldKey: keyof M & string; }
     | { kind: 'sampler';
         binding: number;
         visibility: BindingVisibility;
         type?: SamplerBindingType;
         fieldKey?: keyof M & string; }
     | { kind: 'storageBuffer';
         binding: number;
         visibility: BindingVisibility;
         access: 'read-only' | 'read-write';
         fieldKey: keyof M & string; }
     | { kind: 'storageTexture';
         binding: number;
         visibility: BindingVisibility;
         format: TextureFormat;
         access?: 'write-only' | 'read-only' | 'read-write';
         viewDimension?: TextureViewDimension;
         fieldKey: keyof M & string; };
   ```

   `UniformField<M>` packs one or more material fields into a single uniform-buffer slot: `{ fieldKey: keyof M & string; pack: 'vec4f' | 'vec3f' | 'vec2f' | 'f32' | 'u32' | 'i32' }`. WGSL `std140`-like alignment is handled by the schema walker.

5. **`BindingVisibility = 'vertex' | 'fragment' | 'both'`.** A higher-level alias over the bitfield `ShaderStage` from ADR-0008. Material authors don't need to write `ShaderStage.VERTEX | ShaderStage.FRAGMENT`; the schema walker translates `'both'` to the bitfield. The bitfield remains the canonical HAL shape — `'both'` is sugar for the common material case.

6. **`prepare(material: M)` is a schema-driven walker.** At `MaterialPlugin<M>.build()` time, the schema is walked once to produce a `BindGroupLayout`. At `RenderSet.Prepare`, the same schema drives `prepareMaterial`: each uniform entry is packed into a CPU scratch buffer (one shared `ArrayBuffer` across all materials of one type, reused per frame), uploaded via `renderer.writeBuffer`, and combined with resolved texture/sampler bindings into a `BindGroup`. The walker is the only place that knows the schema's layout — the material class never touches `BindGroupLayout` / `BindGroup` directly.

7. **`ExtendedMaterial` composition is runtime concat with binding offset.** Schemas do *not* compose at the TypeScript type level — `ExtendedMaterial<Base, Extension>` produces a *runtime* merged schema by shifting every extension entry's `binding` past `max(Base.bindGroup.bindings) + 1`. Dev-mode collision check throws if any two shifted bindings collide. The data side of `ExtendedMaterial` composes as `Base & Extension` for instance access; the schema side is concat-with-offset. Documented in ADR-0028.

Composition-only. The class-static `bindGroup` is metadata, not inheritance — `MaterialSchema(StandardMaterial, [...])` does not subclass `StandardMaterial`. No abstract `Material` base class. Extension is via the `Material` interface contract plus the static `bindGroup` property.

## Consequences

**Easier:**

- Material authors write one class with `static bindGroup = MaterialSchema(Self, [...])`. No subclassing, no derive macro, no decorator runtime.
- The pattern mirrors `Transform.requires`, `static onAdd`, `static onRemove` — a TS developer familiar with how this engine declares component metadata reads a material's schema with no new mental model.
- Renames are type-checked: `tsc` errors on stale `fieldKey: 'oldName'` references when the helper is used. CI catches it before the bug ships.
- `ExtendedMaterial`'s composition is concrete: walk Base's bindings, walk Extension's bindings shifted by `maxBase + 1`, throw on collision. Easy to debug; trivial to test.
- Plugin authors who ship a new material in their own package get the same schema surface, the same helper, the same type-checking — no engine-internal escape hatches.
- The decision **does not block adding decorators later.** If Phase 12's system-param ADR (or another future ADR) wants decorators, the schema can grow a decorator form alongside the static-property form. The two coexist; the static form remains the canonical shape.

**Harder / accepted trade-offs:**

- **Raw object literals don't deliver rename safety.** A user who skips the `MaterialSchema(...)` helper and writes `static bindGroup = [...] as const satisfies BindGroupSchema` gets a schema that compiles but does *not* error on field rename. The mistake is silent. Mitigation: TSDoc on `BindGroupSchema` explicitly recommends the helper; the `material` submodule's `index.ts` re-exports `MaterialSchema` prominently; the engine's `StandardMaterial` and `UnlitMaterial` use the helper as the canonical example.
- **Two-step declaration is verbose compared to Bevy's derive.** `static bindGroup = MaterialSchema(StandardMaterial, [...])` is more visual noise than `#[derive(AsBindGroup)]`. Rust gets shorter; TS doesn't. Acceptable: the verbosity is in one place per material, not at every call site.
- **`UniformField<M>`'s `pack` discriminator must be kept in sync with the WGSL struct layout by hand.** A WGSL `vec4<f32>` field must be declared as `pack: 'vec4f'` in the schema; mismatches produce wrong uniform data with no compile-time check. Mitigation: TSDoc; canonical examples; a dev-mode runtime size check (the schema walker can compute the expected UBO size and compare it to the declared WGSL struct via shader reflection when ADR-0022's preprocessor grows that surface).
- **Composition is runtime, not compile-time.** `ExtendedMaterial`'s merged schema is a runtime artifact. A binding-index collision after the shift is caught at plugin-build time with a thrown error, not at TS compile time. Acceptable trade-off — encoding binding-shift arithmetic in the type system is possible but produces error messages no one can read.
- **`@bind_group_data`-equivalent (Bevy's "carry struct data into the pipeline key") is not in this ADR.** Specialization keys flow through `MaterialPipelineKey` (ADR-0028) — that's the surface for "the pipeline cache should see this material's variants." If `bind_group_data` proves load-bearing for a real material, it joins the schema's `BindGroupEntry` shape as a `kind: 'pipeline_data'` variant in a follow-up ADR.

## Not yet done

- **TC39 decorator support.** Lands with the second consumer that wants decorator syntax (system params, observer hooks, or a follow-up `@bind_group_data`-style key declaration). Until then, `experimentalDecorators` stays off.
- **WGSL reflection of the bind-group layout.** Would let the schema check itself against the shader at plugin-build time. Lands with a WGSL parser ADR — the first consumer that needs an AST (hot-reload error mapping, lint, or this) carries it.
- **`bind_group_data`-equivalent for specialization keys.** Bevy's pattern of "carry a struct of pipeline-key data alongside the bind-group fields." Lands when a real material's `specialize()` wants more than `MaterialPipelineKey` exposes.

## Implementation

- `packages/engine/src/material/bind-group-schema.ts` — `BindGroupEntry<M>`, `UniformField<M>`, `BindingVisibility`, `BindGroupSchema<M>` type alias, `MaterialSchema` helper.
- `packages/engine/src/material/prepare-bind-group.ts` — schema walker: `schemaToBindGroupLayout(renderer, schema, label) → BindGroupLayout`; `prepareBindGroup(renderer, schema, material, layout, scratch) → BindGroup`; `uniformPackedSize(fields) → number` for buffer sizing.
- `packages/engine/src/material/bind-group-schema.test.ts` — type-level negative tests (renaming a referenced field surfaces a compile error when the helper is used and does *not* surface a compile error when it isn't); runtime tests for layout-shape round-trip; uniform packing tests.
- `packages/engine/src/material/index.ts` — re-exports `BindGroupSchema`, `MaterialSchema`, `prepareBindGroup`, `schemaToBindGroupLayout`.
- `packages/engine/src/index.ts` — re-exports the material submodule's surface.
