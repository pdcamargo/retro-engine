import { describe, expect, test } from 'bun:test';
import { defineEditorExtensions } from './editor';
import { defineProject } from './index';

describe('defineProject', () => {
  test('returns the definition unchanged', () => {
    const def = { plugins: [], meta: { name: 'My Game' } };
    expect(defineProject(def)).toBe(def);
  });
});

describe('defineEditorExtensions', () => {
  test('returns the extension unchanged', () => {
    const ext = { setup() {} };
    expect(defineEditorExtensions(ext)).toBe(ext);
  });
});
