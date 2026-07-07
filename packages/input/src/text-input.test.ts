import { describe, expect, it } from 'bun:test';

import { charFromKeyDown, ReceivedCharacters } from './text-input';

describe('charFromKeyDown', () => {
  it('accepts a single printable character (layout + shift resolved)', () => {
    expect(charFromKeyDown({ key: 'a' })).toBe('a');
    expect(charFromKeyDown({ key: 'A' })).toBe('A'); // Shift already applied by the platform
    expect(charFromKeyDown({ key: '1' })).toBe('1');
    expect(charFromKeyDown({ key: '!' })).toBe('!');
    expect(charFromKeyDown({ key: ' ' })).toBe(' '); // space is text
    expect(charFromKeyDown({ key: 'é' })).toBe('é');
  });

  it('rejects named (non-printable) keys', () => {
    for (const key of ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'Shift', 'F1']) {
      expect(charFromKeyDown({ key })).toBeNull();
    }
  });

  it('rejects command chords (Ctrl or Meta held)', () => {
    expect(charFromKeyDown({ key: 'c', ctrl: true })).toBeNull(); // Ctrl+C
    expect(charFromKeyDown({ key: 'v', meta: true })).toBeNull(); // Cmd+V
  });

  it('allows AltGr (Ctrl+Alt) which types characters on some layouts', () => {
    expect(charFromKeyDown({ key: '€', ctrl: true, alt: true })).toBe('€');
    // Plain Alt without a produced single char still yields nothing useful.
    expect(charFromKeyDown({ key: 'Dead', alt: true })).toBeNull();
  });
});

describe('ReceivedCharacters', () => {
  it('buffers characters and exposes them as list + joined text', () => {
    const rc = new ReceivedCharacters();
    expect(rc.length).toBe(0);
    expect(rc.text()).toBe('');
    rc.push('h');
    rc.push('i');
    expect(rc.length).toBe(2);
    expect([...rc.chars()]).toEqual(['h', 'i']);
    expect(rc.text()).toBe('hi');
  });

  it('clears back to empty', () => {
    const rc = new ReceivedCharacters();
    rc.push('x');
    rc.clear();
    expect(rc.length).toBe(0);
    expect(rc.text()).toBe('');
  });
});
