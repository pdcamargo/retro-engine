import { afterEach, describe, expect, test } from 'bun:test';

import { isEditorHint, isRunInEditor, runInEditor } from './editor-hint';

const hintGlobal = globalThis as { __retroEditorHint?: boolean };

afterEach(() => {
  delete hintGlobal.__retroEditorHint;
});

describe('isEditorHint', () => {
  test('false when unset (standalone runtime), true when the host sets it', () => {
    expect(isEditorHint()).toBe(false);
    hintGlobal.__retroEditorHint = true;
    expect(isEditorHint()).toBe(true);
  });
});

describe('runInEditor', () => {
  test('returns the same function and marks it', () => {
    const fn = (): void => {};
    expect(runInEditor(fn)).toBe(fn);
    expect(isRunInEditor(fn)).toBe(true);
  });

  test('an unmarked function (or non-function) is not a tool system', () => {
    expect(isRunInEditor((): void => {})).toBe(false);
    expect(isRunInEditor(undefined)).toBe(false);
    expect(isRunInEditor(42)).toBe(false);
  });
});
