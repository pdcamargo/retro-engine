import { afterEach, describe, expect, it } from 'bun:test';

import { isTauri } from './is-tauri';

const TAURI_GLOBAL = '__TAURI_INTERNALS__';

describe('isTauri', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[TAURI_GLOBAL];
  });

  it('is false in a plain environment with no Tauri bridge', () => {
    expect(isTauri()).toBe(false);
  });

  it('is true once the Tauri bridge global is present', () => {
    (globalThis as Record<string, unknown>)[TAURI_GLOBAL] = {};
    expect(isTauri()).toBe(true);
  });
});
