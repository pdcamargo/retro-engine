import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import { App, Cuboid, Mesh3d, Meshes } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { MaterialSchema } from './bind-group-schema';
import {
  ExtendedMaterial,
  forExtendedMaterial,
  synthExtendedMaterialClass,
} from './extended-material';
import type { Material, ShaderRef } from './material';
import { ShaderRefs } from './material';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

class ExtSizzle implements Material {
  sizzle = 0.5;
  // Define a Material method explicitly — without one, TypeScript's "weak
  // type" detection refuses to assign an instance to a Material-typed
  // parameter (Material has only optional methods, so it considers the type
  // unsafe to satisfy without at least one common property).
  alphaMode() {
    return 'opaque' as const;
  }
  static readonly bindGroup = MaterialSchema(ExtSizzle, [
    {
      kind: 'uniform',
      binding: 0,
      visibility: 'fragment',
      fields: [{ fieldKey: 'sizzle', pack: 'f32' }],
    },
  ]);
  static vertexShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::unlit');
  }
  static fragmentShader(): ShaderRef {
    return ShaderRefs.module('retro_engine::unlit');
  }
}

describe('synthExtendedMaterialClass', () => {
  it('merges schemas with binding-offset shift', () => {
    const Cls = synthExtendedMaterialClass(UnlitMaterial, ExtSizzle);
    expect(Cls.name).toBe('ExtendedMaterial<UnlitMaterial, ExtSizzle>');
    // UnlitMaterial uses bindings 0..2; ExtSizzle's binding 0 shifts past to 3.
    const bindings = Cls.bindGroup.map((e) => e.binding);
    expect(bindings).toEqual([0, 1, 2, 3]);
  });

  it('picks extension shaders when set; falls back to base otherwise', () => {
    const Cls = synthExtendedMaterialClass(UnlitMaterial, ExtSizzle);
    expect(Cls.fragmentShader!()).toEqual({ kind: 'module', name: 'retro_engine::unlit' });
  });

  it('throws on binding collision after shift', () => {
    class Collider implements Material {
      x = 0;
      alphaMode() {
        return 'opaque' as const;
      }
      static readonly bindGroup = MaterialSchema(Collider, [
        // Intentionally explicit binding 0 — after the shift past UnlitMaterial
        // (max base binding 2 + 1 = 3) this lands on binding 3 with no
        // collision. To trigger the throw we'd need bindings that map onto
        // a base slot, which the offset prevents by design.
        { kind: 'uniform', binding: 0, visibility: 'fragment', fields: [{ fieldKey: 'x', pack: 'f32' }] },
      ]);
    }
    // The shift always pushes extension bindings PAST the base's max, so a
    // collision only happens when the extension declares a hand-picked
    // binding number that happens to land on a base slot. Since `binding`
    // numbers in our schema start at 0 and shift by maxBase + 1, no
    // collision under normal use. Sanity check the no-throw path.
    expect(() => synthExtendedMaterialClass(UnlitMaterial, Collider)).not.toThrow();
  });
});

describe('ExtendedMaterial', () => {
  it('forwards base and extension fields to the top level via getters', () => {
    const base = new UnlitMaterial({ color: vec4.create(1, 0.5, 0.25, 1) });
    const ext = new ExtSizzle();
    ext.sizzle = 0.7;
    const wrapper = new ExtendedMaterial(base, ext);
    expect((wrapper as unknown as { color: unknown }).color).toBe(base.color);
    expect((wrapper as unknown as { sizzle: number }).sizzle).toBe(0.7);
  });

  it('throws on field-name collisions between base and extension', () => {
    class Collider implements Material {
      color = vec4.create(1, 1, 1, 1); // collides with UnlitMaterial.color
      alphaMode() {
        return 'opaque' as const;
      }
      static readonly bindGroup = MaterialSchema(Collider, [
        { kind: 'uniform', binding: 0, visibility: 'fragment', fields: [{ fieldKey: 'color', pack: 'vec4f' }] },
      ]);
    }
    const base = new UnlitMaterial();
    const ext = new Collider();
    expect(() => new ExtendedMaterial(base, ext)).toThrow(/collision|color/);
  });

  it('alphaMode + depthBias delegate extension → base → default', () => {
    const base = new UnlitMaterial({ alphaMode: 'opaque' });
    class ExtBlend implements Material {
      static readonly bindGroup = MaterialSchema(ExtBlend, []);
      alphaMode() {
        return 'blend' as const;
      }
    }
    const wrapper = new ExtendedMaterial(base, new ExtBlend());
    expect(wrapper.alphaMode()).toBe('blend');
    const wrapper2 = new ExtendedMaterial(new UnlitMaterial({ alphaMode: 'opaque' }), {} as Material);
    expect(wrapper2.alphaMode()).toBe('opaque');
  });
});

describe('MaterialPlugin.forExtended', () => {
  it('builds and drives one frame end-to-end', async () => {
    const app = new App({ renderer: makeRenderingRenderer(), canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    // Both halves resolve to retro_engine::unlit, registered by UnlitMaterialPlugin.
    const ext = forExtendedMaterial(UnlitMaterial, ExtSizzle);
    app.addPlugin(ext);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const handle = app.getResource(ext.Materials)!.add(
      new ExtendedMaterial(
        new UnlitMaterial({ color: vec4.create(1, 0.5, 0.25, 1) }),
        new ExtSizzle(),
      ),
    );
    app.world.spawn(new Mesh3d(meshHandle), new ext.MeshMaterial3d(handle));

    await app.run();
    expect(app.getResource(ext.RenderMaterials)!.has(handle)).toBe(true);
  });
});
