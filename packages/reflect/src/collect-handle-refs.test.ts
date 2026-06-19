import { describe, expect, it } from 'bun:test';

import { asAssetIndex, makeHandle, type AssetGuid, type Handle } from '@retro-engine/assets';

import type { EncodeEnv, HandleRef } from './codec';
import { collectComponentHandleRefs, collectHandleRefs, encodeComponent } from './codec';
import { t } from './field-type';
import { TypeRegistry } from './type-registry';

/** Encode context that writes a handle's GUID as its reference (the on-disk form). */
const encEnv = (registry: TypeRegistry): EncodeEnv => ({
  registry,
  entityId: (e) => e as unknown as number,
  handleRef: (_assetType, h) => h.guid,
});

const handle = <T>(guid: string): Handle<T> => makeHandle<T>(asAssetIndex(0), guid as AssetGuid);

const guids = (refs: HandleRef[]): string[] => refs.map((r) => r.guid).sort();

describe('collectHandleRefs', () => {
  const reg = new TypeRegistry();

  it('finds a scalar handle and skips null / absent / non-handle fields', () => {
    const fields = {
      image: t.handle<unknown>('Image'),
      normalMap: t.handle<unknown>('Image').nullable(),
      name: t.string,
    };
    const out: HandleRef[] = [];
    collectHandleRefs(fields, { image: 'g-img', normalMap: null, name: 'hero' }, reg, out);
    expect(out).toEqual([{ assetType: 'Image', guid: 'g-img' }]);

    const absent: HandleRef[] = [];
    collectHandleRefs(fields, { name: 'hero' }, reg, absent);
    expect(absent).toEqual([]);
  });

  it('recurses arrays, tuples, and structs', () => {
    const fields = {
      meshes: t.array(t.handle<unknown>('Mesh')),
      pair: t.tuple(t.handle<unknown>('Image'), t.number),
      nested: t.struct({ icon: t.handle<unknown>('Image') }),
    };
    const out: HandleRef[] = [];
    collectHandleRefs(
      fields,
      { meshes: ['m1', 'm2'], pair: ['p-img', 3], nested: { icon: 'n-img' } },
      reg,
      out,
    );
    expect(guids(out)).toEqual(['m1', 'm2', 'n-img', 'p-img']);
  });

  it('skips fields marked skip()', () => {
    const fields = { image: t.handle<unknown>('Image').skip() };
    const out: HandleRef[] = [];
    collectHandleRefs(fields, { image: 'g-img' }, reg, out);
    expect(out).toEqual([]);
  });

  it('recurses a variant arm carrying a handle', () => {
    const fields = {
      source: t.variant('kind', { none: {}, texture: { image: t.handle<unknown>('Image') } }),
    };
    const found: HandleRef[] = [];
    collectHandleRefs(fields, { source: { kind: 'texture', image: 'v-img' } }, reg, found);
    expect(found).toEqual([{ assetType: 'Image', guid: 'v-img' }]);

    const none: HandleRef[] = [];
    collectHandleRefs(fields, { source: { kind: 'none' } }, reg, none);
    expect(none).toEqual([]);
  });
});

describe('collectComponentHandleRefs', () => {
  it('walks a nested registered type via its schema', () => {
    const reg = new TypeRegistry();
    class Material {
      albedo: Handle<unknown> = handle('a');
    }
    class Renderer {
      mesh: Handle<unknown> = handle('m');
      material: Material = new Material();
    }
    reg.registerType(Material, { albedo: t.handle<unknown>('Image') });
    const rendererType = reg.registerComponent(Renderer, {
      mesh: t.handle<unknown>('Mesh'),
      material: t.type(Material),
    });

    const instance = new Renderer();
    instance.mesh = handle('mesh-guid');
    instance.material.albedo = handle('albedo-guid');
    const serialized = encodeComponent(rendererType, instance, encEnv(reg));

    const out: HandleRef[] = [];
    collectComponentHandleRefs(rendererType, serialized, reg, out);
    expect(out).toEqual([
      { assetType: 'Mesh', guid: 'mesh-guid' },
      { assetType: 'Image', guid: 'albedo-guid' },
    ]);
  });
});
