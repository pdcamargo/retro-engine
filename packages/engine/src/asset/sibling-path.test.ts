import { describe, expect, it } from 'bun:test';

import { decodeDataUri, dirOf, isDataUri, resolveSiblingPath } from './sibling-path';

describe('dirOf', () => {
  it('returns empty for a path with no directory', () => {
    expect(dirOf('model.gltf')).toBe('');
  });

  it('returns the parent for a nested path', () => {
    expect(dirOf('models/duck/duck.gltf')).toBe('models/duck');
  });

  it('drops only the final segment', () => {
    expect(dirOf('a/b/c')).toBe('a/b');
  });
});

describe('resolveSiblingPath', () => {
  it('joins a sibling against a path with no directory', () => {
    expect(resolveSiblingPath('model.gltf', 'buffer.bin')).toBe('buffer.bin');
  });

  it('joins a sibling against the path directory', () => {
    expect(resolveSiblingPath('models/duck/duck.gltf', 'duck.bin')).toBe('models/duck/duck.bin');
  });

  it('joins a nested relative path', () => {
    expect(resolveSiblingPath('models/duck.gltf', 'textures/wood.png')).toBe(
      'models/textures/wood.png',
    );
  });

  it('percent-decodes the relative path before joining', () => {
    expect(resolveSiblingPath('models/scene.gltf', 'base%20color.png')).toBe(
      'models/base color.png',
    );
  });

  it('leaves "../" unnormalized (the source layer resolves it)', () => {
    expect(resolveSiblingPath('models/duck.gltf', '../shared/atlas.png')).toBe(
      'models/../shared/atlas.png',
    );
  });
});

describe('isDataUri', () => {
  it('recognizes a data URI', () => {
    expect(isDataUri('data:application/octet-stream;base64,AAAA')).toBe(true);
  });

  it('rejects a plain path', () => {
    expect(isDataUri('models/duck.bin')).toBe(false);
  });
});

describe('decodeDataUri', () => {
  it('decodes a base64 payload', () => {
    // "hi" → base64 "aGk="
    expect(decodeDataUri('data:application/octet-stream;base64,aGk=')).toEqual(
      new TextEncoder().encode('hi'),
    );
  });

  it('decodes a percent-encoded text payload', () => {
    expect(decodeDataUri('data:text/plain,hello%20world')).toEqual(
      new TextEncoder().encode('hello world'),
    );
  });

  it('throws on a non-data URI', () => {
    expect(() => decodeDataUri('models/duck.bin')).toThrow();
  });
});
