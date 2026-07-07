import { describe, expect, it } from 'bun:test';

import { applyEditKey, applyTextInputFrame, insertText, UiTextInput } from './ui-text-input';

describe('UiTextInput', () => {
  it('defaults the caret to the end of the initial value', () => {
    expect(new UiTextInput({ value: 'hello' }).cursor).toBe(5);
    expect(new UiTextInput().value).toBe('');
    expect(new UiTextInput().cursor).toBe(0);
  });

  it('requires the interaction + focus machinery', () => {
    expect(UiTextInput.requires.map((c) => c.name)).toEqual(['UiNode', 'Interactable', 'Focusable']);
  });
});

describe('insertText', () => {
  it('inserts at the caret and advances it', () => {
    expect(insertText({ value: 'ac', cursor: 1 }, 'b')).toEqual({ value: 'abc', cursor: 2 });
    expect(insertText({ value: '', cursor: 0 }, 'hi')).toEqual({ value: 'hi', cursor: 2 });
  });

  it('appends at the end', () => {
    expect(insertText({ value: 'ab', cursor: 2 }, 'c')).toEqual({ value: 'abc', cursor: 3 });
  });

  it('truncates the insertion to fit maxLength', () => {
    expect(insertText({ value: 'ab', cursor: 2 }, 'cdef', 4)).toEqual({ value: 'abcd', cursor: 4 });
    // Already full → no change.
    expect(insertText({ value: 'abcd', cursor: 2 }, 'x', 4)).toEqual({ value: 'abcd', cursor: 2 });
  });

  it('clamps an out-of-range caret before inserting', () => {
    expect(insertText({ value: 'ab', cursor: 99 }, 'c')).toEqual({ value: 'abc', cursor: 3 });
  });
});

describe('applyEditKey', () => {
  it('backspace removes the char before the caret', () => {
    expect(applyEditKey({ value: 'abc', cursor: 2 }, 'backspace')).toEqual({ value: 'ac', cursor: 1 });
    // At the start → no-op.
    expect(applyEditKey({ value: 'abc', cursor: 0 }, 'backspace')).toEqual({ value: 'abc', cursor: 0 });
  });

  it('delete removes the char at the caret', () => {
    expect(applyEditKey({ value: 'abc', cursor: 1 }, 'delete')).toEqual({ value: 'ac', cursor: 1 });
    // At the end → no-op.
    expect(applyEditKey({ value: 'abc', cursor: 3 }, 'delete')).toEqual({ value: 'abc', cursor: 3 });
  });

  it('moves the caret with arrows, home, and end (clamped)', () => {
    expect(applyEditKey({ value: 'abc', cursor: 1 }, 'left')).toEqual({ value: 'abc', cursor: 0 });
    expect(applyEditKey({ value: 'abc', cursor: 0 }, 'left')).toEqual({ value: 'abc', cursor: 0 });
    expect(applyEditKey({ value: 'abc', cursor: 2 }, 'right')).toEqual({ value: 'abc', cursor: 3 });
    expect(applyEditKey({ value: 'abc', cursor: 3 }, 'right')).toEqual({ value: 'abc', cursor: 3 });
    expect(applyEditKey({ value: 'abc', cursor: 2 }, 'home')).toEqual({ value: 'abc', cursor: 0 });
    expect(applyEditKey({ value: 'abc', cursor: 0 }, 'end')).toEqual({ value: 'abc', cursor: 3 });
  });
});

describe('applyTextInputFrame', () => {
  it('types characters at the caret', () => {
    expect(applyTextInputFrame({ value: '', cursor: 0 }, [], 'hi')).toEqual({ value: 'hi', cursor: 2 });
  });

  it('applies caret keys before inserting this frame’s text', () => {
    // Backspace deletes 'c', then 'X' is inserted at the new caret.
    expect(applyTextInputFrame({ value: 'abc', cursor: 3 }, ['backspace'], 'X')).toEqual({
      value: 'abX',
      cursor: 3,
    });
  });

  it('moves the caret with keys and no text', () => {
    expect(applyTextInputFrame({ value: 'abc', cursor: 3 }, ['home'], '')).toEqual({ value: 'abc', cursor: 0 });
  });

  it('honors maxLength for the inserted text', () => {
    expect(applyTextInputFrame({ value: 'ab', cursor: 2 }, [], 'cdef', 3)).toEqual({ value: 'abc', cursor: 3 });
  });
});
