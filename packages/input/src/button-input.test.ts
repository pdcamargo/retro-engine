import { describe, expect, it } from 'bun:test';

import { ButtonInput } from './button-input';

describe('ButtonInput — press / release', () => {
  it('press marks pressed and justPressed', () => {
    const input = new ButtonInput<string>();
    input.press('KeyW');
    expect(input.pressed('KeyW')).toBe(true);
    expect(input.justPressed('KeyW')).toBe(true);
    expect(input.justReleased('KeyW')).toBe(false);
  });

  it('a re-press while already held does not re-fire justPressed', () => {
    const input = new ButtonInput<string>();
    input.press('KeyW');
    input.clear();
    input.press('KeyW'); // e.g. a key-repeat event
    expect(input.pressed('KeyW')).toBe(true);
    expect(input.justPressed('KeyW')).toBe(false);
  });

  it('a repeat press marks repeated (not justPressed) and holds pressed', () => {
    const input = new ButtonInput<string>();
    input.press('Backspace'); // initial press
    input.clear();
    input.press('Backspace', true); // OS auto-repeat
    expect(input.pressed('Backspace')).toBe(true);
    expect(input.justPressed('Backspace')).toBe(false);
    expect(input.repeated('Backspace')).toBe(true);
    expect(input.justPressedOrRepeated('Backspace')).toBe(true);
  });

  it('the initial (non-repeat) press is justPressed and justPressedOrRepeated, not repeated', () => {
    const input = new ButtonInput<string>();
    input.press('Backspace');
    expect(input.repeated('Backspace')).toBe(false);
    expect(input.justPressed('Backspace')).toBe(true);
    expect(input.justPressedOrRepeated('Backspace')).toBe(true);
  });

  it('clear drops the repeated set', () => {
    const input = new ButtonInput<string>();
    input.press('Backspace');
    input.clear();
    input.press('Backspace', true);
    expect(input.repeated('Backspace')).toBe(true);
    input.clear();
    expect(input.repeated('Backspace')).toBe(false);
    expect(input.pressed('Backspace')).toBe(true); // still held
  });

  it('release marks justReleased and clears pressed', () => {
    const input = new ButtonInput<string>();
    input.press('KeyW');
    input.clear();
    input.release('KeyW');
    expect(input.pressed('KeyW')).toBe(false);
    expect(input.justReleased('KeyW')).toBe(true);
  });

  it('releasing a key that was never pressed does not fire justReleased', () => {
    const input = new ButtonInput<string>();
    input.release('KeyW');
    expect(input.justReleased('KeyW')).toBe(false);
  });
});

describe('ButtonInput — clear (per-frame lifecycle)', () => {
  it('clear drops justPressed/justReleased but keeps held keys', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    input.clear();
    expect(input.pressed('KeyA')).toBe(true);
    expect(input.justPressed('KeyA')).toBe(false);
    expect(input.justReleased('KeyA')).toBe(false);
  });

  it('justPressed is true for exactly one frame', () => {
    const input = new ButtonInput<string>();
    // Frame 1: press
    input.clear();
    input.press('Space');
    expect(input.justPressed('Space')).toBe(true);
    // Frame 2: nothing new
    input.clear();
    expect(input.justPressed('Space')).toBe(false);
    expect(input.pressed('Space')).toBe(true);
  });
});

describe('ButtonInput — any / all / getters', () => {
  it('anyPressed / allPressed', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    input.press('KeyB');
    expect(input.anyPressed(['KeyA', 'KeyX'])).toBe(true);
    expect(input.allPressed(['KeyA', 'KeyB'])).toBe(true);
    expect(input.allPressed(['KeyA', 'KeyC'])).toBe(false);
    expect(input.anyPressed(['KeyX', 'KeyY'])).toBe(false);
  });

  it('anyJustPressed / anyJustReleased', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    expect(input.anyJustPressed(['KeyA', 'KeyB'])).toBe(true);
    input.clear();
    input.release('KeyA');
    expect(input.anyJustReleased(['KeyA'])).toBe(true);
  });

  it('getters enumerate the sets', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    input.press('KeyB');
    expect([...input.getPressed()].sort()).toEqual(['KeyA', 'KeyB']);
    expect([...input.getJustPressed()].sort()).toEqual(['KeyA', 'KeyB']);
    input.clear();
    input.release('KeyA');
    expect([...input.getJustReleased()]).toEqual(['KeyA']);
  });
});

describe('ButtonInput — releaseAll / reset', () => {
  it('releaseAll marks every held key just-released', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    input.press('KeyB');
    input.clear();
    input.releaseAll();
    expect(input.pressed('KeyA')).toBe(false);
    expect(input.pressed('KeyB')).toBe(false);
    expect(input.justReleased('KeyA')).toBe(true);
    expect(input.justReleased('KeyB')).toBe(true);
  });

  it('reset forgets a single key across all sets', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    input.reset('KeyA');
    expect(input.pressed('KeyA')).toBe(false);
    expect(input.justPressed('KeyA')).toBe(false);
  });

  it('resetAll forgets everything', () => {
    const input = new ButtonInput<string>();
    input.press('KeyA');
    input.press('KeyB');
    input.resetAll();
    expect([...input.getPressed()]).toEqual([]);
    expect([...input.getJustPressed()]).toEqual([]);
  });
});
