import type {
  RenderPipelineDescriptor,
  VertexBufferLayout,
} from '@retro-engine/renderer-core';

import type { BindGroupEntry, BindGroupSchema } from './bind-group-schema';
import type { AlphaMode, Material, MaterialPipelineKey, ShaderRef } from './material';
import { ShaderRefs } from './material';
import type { MaterialCtor } from './material-plugin';
import { MaterialPlugin } from './material-plugin';

/**
 * Wrapper material composing a `Base` material with an `Extension` material.
 * Both are stored on the wrapper as `base` / `extension`; at construction
 * time, the wrapper installs getters that forward every own enumerable
 * property from `base` and `extension` to the top level, so the bind-group
 * schema walker reads `extWrapped[fieldKey]` and resolves to the correct
 * field on whichever half declared it.
 *
 * Name collisions between `base` and `extension` field names throw at
 * construction time — the merged schema would otherwise alias one half's
 * field over the other. Author your extension's field names to avoid
 * collision with the base's (e.g., prefix with `ext_` if necessary).
 *
 * Construct via {@link MaterialPlugin.forExtended} which builds the
 * synthesised class with the merged schema + shader resolution + specialize
 * composition; users do not instantiate `ExtendedMaterial` against a raw
 * `MaterialPlugin` themselves.
 */
export class ExtendedMaterial<B extends Material, E extends Material> implements Material {
  readonly base: B;
  readonly extension: E;

  constructor(base: B, extension: E) {
    this.base = base;
    this.extension = extension;
    // Forward own enumerable properties to the top level via getter/setter
    // pairs so the bind-group schema walker reads `wrapper[fieldKey]` and
    // resolves to the right half. Collision detection — the schema would
    // alias one half's field over the other.
    const baseKeys = new Set(Object.keys(base));
    const extKeys = new Set(Object.keys(extension));
    for (const key of baseKeys) {
      if (extKeys.has(key)) {
        throw new Error(
          `ExtendedMaterial: field name '${key}' is declared on both base and extension; rename one to disambiguate.`,
        );
      }
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        get: () => (base as unknown as Record<string, unknown>)[key],
        set: (v: unknown) => {
          (base as unknown as Record<string, unknown>)[key] = v;
        },
      });
    }
    for (const key of extKeys) {
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        get: () => (extension as unknown as Record<string, unknown>)[key],
        set: (v: unknown) => {
          (extension as unknown as Record<string, unknown>)[key] = v;
        },
      });
    }
  }

  alphaMode(): AlphaMode {
    return this.extension.alphaMode?.() ?? this.base.alphaMode?.() ?? 'opaque';
  }

  depthBias(): number {
    return this.extension.depthBias?.() ?? this.base.depthBias?.() ?? 0;
  }
}

/**
 * Build a synthesised `MaterialCtor` for the wrapper material that
 * `MaterialPlugin` registers under one resource per material-pair. Merges
 * the two halves' bind-group schemas with binding-offset shift, picks the
 * extension's shader when set (falls back to base), and composes
 * `specialize` (base runs first, extension runs after).
 *
 * Binding-shift rule: extension entries shift past `max(Base bindings) + 1`
 * — author your extension's WGSL with the shifted binding numbers
 * (`@group(2) @binding(<base_max + 1 + N>)`). The `forExtended` factory
 * documents the exact shift in the resulting material's TSDoc when needed;
 * for Phase 7, consult the synthesised class's `bindGroup` array for the
 * authoritative mapping.
 */
export const synthExtendedMaterialClass = <B extends Material, E extends Material>(
  Base: MaterialCtor<B>,
  Extension: MaterialCtor<E>,
): MaterialCtor<ExtendedMaterial<B, E>> => {
  const baseSchema = Base.bindGroup as BindGroupSchema<B>;
  const extSchema = Extension.bindGroup as BindGroupSchema<E>;
  const maxBaseBinding = baseSchema.reduce(
    (m, e) => (e.binding > m ? e.binding : m),
    -1,
  );
  const offset = maxBaseBinding + 1;
  const mergedEntries: BindGroupEntry<ExtendedMaterial<B, E>>[] = [];
  for (const entry of baseSchema) {
    mergedEntries.push(entry as unknown as BindGroupEntry<ExtendedMaterial<B, E>>);
  }
  const seenBindings = new Set<number>(baseSchema.map((e) => e.binding));
  for (const entry of extSchema) {
    const shifted = entry.binding + offset;
    if (seenBindings.has(shifted)) {
      throw new Error(
        `synthExtendedMaterialClass: extension binding ${entry.binding} (shifted to ${shifted}) collides with a base binding. Rebase your extension's bindings or check the merge offset.`,
      );
    }
    seenBindings.add(shifted);
    mergedEntries.push({
      ...entry,
      binding: shifted,
    } as unknown as BindGroupEntry<ExtendedMaterial<B, E>>);
  }

  type Wrapper = ExtendedMaterial<B, E>;
  const ExtCtor = class ExtendedMaterialSubclass extends ExtendedMaterial<B, E> {
    static readonly bindGroup: BindGroupSchema<Wrapper> = mergedEntries;
    static vertexShader(): ShaderRef {
      const ext = Extension.vertexShader?.();
      if (ext !== undefined && ext.kind !== 'default') return ext;
      return Base.vertexShader?.() ?? ShaderRefs.default();
    }
    static fragmentShader(): ShaderRef {
      const ext = Extension.fragmentShader?.();
      if (ext !== undefined && ext.kind !== 'default') return ext;
      return Base.fragmentShader?.() ?? ShaderRefs.default();
    }
    static specialize(
      descriptor: RenderPipelineDescriptor,
      vertexLayout: VertexBufferLayout,
      key: MaterialPipelineKey,
    ): void {
      Base.specialize?.(descriptor, vertexLayout, key);
      Extension.specialize?.(descriptor, vertexLayout, key);
    }
  };
  Object.defineProperty(ExtCtor, 'name', {
    value: `ExtendedMaterial<${Base.name}, ${Extension.name}>`,
  });
  return ExtCtor as unknown as MaterialCtor<Wrapper>;
};

/**
 * Convenience factory: build a `MaterialPlugin` for an
 * `ExtendedMaterial<Base, Extension>` pair. Uses
 * {@link synthExtendedMaterialClass} to produce the merged class.
 *
 * ```ts
 * const celPbr = MaterialPlugin.forExtended(StandardMaterial, CelShadeExtension);
 * app.addPlugin(new StandardMaterialPlugin());
 * app.addPlugin(celPbr);
 * const handle = world.getResource(celPbr.Materials)!.add(
 *   new ExtendedMaterial(
 *     new StandardMaterial({ baseColor: vec4(...) }),
 *     new CelShadeExtension({ bands: 4 }),
 *   ),
 * );
 * ```
 */
export const forExtendedMaterial = <B extends Material, E extends Material>(
  Base: MaterialCtor<B>,
  Extension: MaterialCtor<E>,
): MaterialPlugin<ExtendedMaterial<B, E>> => {
  const cls = synthExtendedMaterialClass(Base, Extension);
  return new MaterialPlugin(cls);
};

// Bind the static helper onto `MaterialPlugin` so consumers can write
// `MaterialPlugin.forExtended(Base, Extension)` per ADR-0028's API sketch.
(MaterialPlugin as unknown as {
  forExtended: typeof forExtendedMaterial;
}).forExtended = forExtendedMaterial;

declare module './material-plugin' {
  // Augment MaterialPlugin's namespace with the static factory.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace MaterialPlugin {
    function forExtended<B extends Material, E extends Material>(
      Base: MaterialCtor<B>,
      Extension: MaterialCtor<E>,
    ): MaterialPlugin<ExtendedMaterial<B, E>>;
  }
}
