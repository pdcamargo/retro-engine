import { describe, expect, it } from 'bun:test';

import { parseRss, parseSelector } from './rss-parser';

describe('parseSelector', () => {
  it('parses a bare type selector', () => {
    expect(parseSelector('Button')).toMatchObject({ type: 'Button', classes: [], states: [] });
  });

  it('parses classes, name, and states in a compound selector', () => {
    const sel = parseSelector('Button.primary.big#save:hover:disabled');
    expect(sel.type).toBe('Button');
    expect(sel.name).toBe('save');
    expect(sel.classes).toEqual(['primary', 'big']);
    expect(sel.states).toEqual(['hover', 'disabled']);
    expect(sel.universal).toBe(false);
  });

  it('parses the universal selector only when standalone', () => {
    expect(parseSelector('*').universal).toBe(true);
    expect(parseSelector('.foo').universal).toBe(false);
  });
});

describe('parseRss', () => {
  it('parses rules, strips comments, and expands comma groups with source order', () => {
    const rules = parseRss(`
      /* a comment */
      .a, .b { width: 10px; }
      #main { height: 20px; }
    `);
    expect(rules).toHaveLength(3);
    expect(rules[0]!.selector.classes).toEqual(['a']);
    expect(rules[1]!.selector.classes).toEqual(['b']);
    expect(rules[0]!.order).toBe(0);
    expect(rules[1]!.order).toBe(1);
    expect(rules[2]!.selector.name).toBe('main');
    expect(rules[2]!.declarations).toEqual([{ property: 'height', value: '20px' }]);
  });

  it('skips selector-less / body-less fragments', () => {
    expect(parseRss('   ')).toHaveLength(0);
    expect(parseRss('.x { }')).toHaveLength(1); // empty body is a valid (no-op) rule
    expect(parseRss('.x { }')[0]!.declarations).toHaveLength(0);
  });
});
