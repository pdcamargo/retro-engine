import { describe, expect, it } from 'bun:test';

import { type FieldPath, pathKeyOf, readPath, writePathLeaf } from './field-path';

describe('field-path', () => {
  it('reads a nested field and a typed-array index', () => {
    const root = { translation: new Float32Array([1, 2, 3]), tag: { name: 'a' } };
    expect(readPath(root, [{ kind: 'field', name: 'translation' }, { kind: 'index', index: 1 }])).toBe(2);
    expect(readPath(root, [{ kind: 'field', name: 'tag' }, { kind: 'field', name: 'name' }])).toBe('a');
  });

  it('writes a leaf in place, preserving the root and container identity', () => {
    const root = { translation: new Float32Array([1, 2, 3]) };
    const arr = root.translation;
    writePathLeaf(root, [{ kind: 'field', name: 'translation' }, { kind: 'index', index: 0 }], 9);
    expect(root.translation).toBe(arr);
    expect(arr[0]).toBe(9);
  });

  it('serializes a canonical key', () => {
    const path: FieldPath = [{ kind: 'field', name: 'a' }, { kind: 'index', index: 2 }, { kind: 'field', name: 'b' }];
    expect(pathKeyOf(path)).toBe('a/[2]/b');
  });

  it('throws on an empty path write', () => {
    expect(() => writePathLeaf({}, [], 1)).toThrow();
  });
});
