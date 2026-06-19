import { describe, expect, test } from 'bun:test';

import { classifyChange } from './watch-router';

describe('classifyChange', () => {
  test('code files trigger a rebuild', () => {
    expect(classifyChange('src/game.ts')).toBe('rebuild');
    expect(classifyChange('assets/player/health.ts')).toBe('rebuild');
  });

  test('scenes and prefabs trigger a scene reload', () => {
    expect(classifyChange('assets/levels/main.rescene')).toBe('reload-scene');
    expect(classifyChange('assets/prefabs/player.reprefab')).toBe('reload-scene');
  });

  test('.meta and asset binaries trigger a re-index', () => {
    expect(classifyChange('assets/art/hero.png.meta')).toBe('reindex');
    expect(classifyChange('assets/art/hero.png')).toBe('reindex');
    expect(classifyChange('assets/models/clover.glb')).toBe('reindex');
  });

  test('unrelated files are ignored', () => {
    expect(classifyChange('README.md')).toBe('ignore');
    expect(classifyChange('.gitignore')).toBe('ignore');
  });
});
