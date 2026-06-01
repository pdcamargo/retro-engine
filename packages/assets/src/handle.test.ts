import { describe, expect, it } from 'bun:test';

import { asAssetIndex } from './asset-id';
import { handleEq, makeHandle } from './handle';
import type { Handle } from './handle';

interface Mesh {
  readonly __mesh: 'mesh';
}
interface Image {
  readonly __image: 'image';
}

describe('makeHandle', () => {
  it('carries the index and no guid by default', () => {
    const handle = makeHandle<Mesh>(asAssetIndex(3));
    expect(handle.index).toBe(asAssetIndex(3));
    expect(handle.guid).toBeUndefined();
  });

  it('carries a guid when one is supplied', () => {
    const handle = makeHandle<Mesh>(asAssetIndex(3), 'g' as Handle<Mesh>['guid']);
    expect(handle.guid).toBe('g' as Handle<Mesh>['guid']);
  });
});

describe('handleEq', () => {
  it('is equality by index, ignoring guid', () => {
    const a = makeHandle<Mesh>(asAssetIndex(1));
    const b = makeHandle<Mesh>(asAssetIndex(1), 'g' as Handle<Mesh>['guid']);
    const c = makeHandle<Mesh>(asAssetIndex(2));
    expect(handleEq(a, b)).toBe(true);
    expect(handleEq(a, c)).toBe(false);
  });
});

describe('phantom brand (type-level)', () => {
  it('keeps Handle<A> from being assignable to Handle<B>', () => {
    const meshHandle = makeHandle<Mesh>(asAssetIndex(1));
    // @ts-expect-error — Handle<Mesh> is not assignable to Handle<Image> (phantom brand)
    const imageHandle: Handle<Image> = meshHandle;
    void imageHandle;
    expect(meshHandle.index).toBe(asAssetIndex(1));
  });
});
