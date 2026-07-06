import { describe, expect, it } from 'bun:test';

import { FlexLayoutEngine } from './flex-layout';
import { parseRss, parseSelector } from './rss-parser';
import {
  matches,
  resolveDeclarations,
  resolveUiStyle,
  specificity,
  type StyleNode,
} from './rss-resolve';

const node = (over: Partial<StyleNode> = {}): StyleNode => ({ classes: [], states: [], ...over });

describe('matches', () => {
  it('matches on type, class, name, and state; requires all parts', () => {
    const sel = parseSelector('Button.primary:hover');
    expect(matches(sel, node({ type: 'Button', classes: ['primary'], states: ['hover'] }))).toBe(true);
    expect(matches(sel, node({ type: 'Button', classes: ['primary'] }))).toBe(false); // missing state
    expect(matches(sel, node({ type: 'Label', classes: ['primary'], states: ['hover'] }))).toBe(false);
    expect(matches(parseSelector('*'), node({ type: 'Anything' }))).toBe(true);
  });
});

describe('specificity', () => {
  it('orders #name > .class/:state > type', () => {
    expect(specificity(parseSelector('#a'))).toEqual([1, 0, 0]);
    expect(specificity(parseSelector('.a:hover'))).toEqual([0, 2, 0]);
    expect(specificity(parseSelector('Button'))).toEqual([0, 0, 1]);
  });
});

describe('resolveDeclarations (cascade)', () => {
  it('lets higher specificity win regardless of order', () => {
    const rules = parseRss(`#save { width: 99px; } .btn { width: 10px; } Button { width: 5px; }`);
    const props = resolveDeclarations(rules, node({ type: 'Button', name: 'save', classes: ['btn'] }));
    expect(props.width).toBe('99px'); // #save wins over .btn and Button
  });

  it('breaks specificity ties by source order (later wins)', () => {
    const rules = parseRss(`.btn { width: 10px; } .primary { width: 20px; }`);
    const props = resolveDeclarations(rules, node({ classes: ['btn', 'primary'] }));
    expect(props.width).toBe('20px'); // same specificity → later rule wins
  });
});

describe('resolveUiStyle (declaration mapping)', () => {
  it('maps layout properties, lengths, and edge shorthands', () => {
    const rules = parseRss(`
      .panel {
        flex-direction: column;
        justify-content: center;
        align-items: flex-end;
        width: 200px;
        height: auto;
        padding: 4px 8px;
        gap: 6px;
        flex-grow: 2;
      }
    `);
    const style = resolveUiStyle(rules, node({ classes: ['panel'] }));
    expect(style.flexDirection).toBe('column');
    expect(style.justifyContent).toBe('center');
    expect(style.alignItems).toBe('flex-end');
    expect(style.width).toBe(200);
    expect(style.height).toBeUndefined(); // 'auto'
    expect(style.padding).toEqual({ top: 4, right: 8, bottom: 4, left: 8 });
    expect(style.gap).toBe(6);
    expect(style.flexGrow).toBe(2);
  });

  it('lets inline overrides beat the stylesheet', () => {
    const rules = parseRss(`.x { width: 10px; }`);
    const style = resolveUiStyle(rules, node({ classes: ['x'] }), { width: 500 });
    expect(style.width).toBe(500);
  });
});

describe('rss → layout (end to end)', () => {
  it('styles a tree via .rss and lays it out', () => {
    const rules = parseRss(`
      .panel { flex-direction: column; padding: 10px; width: 200px; height: 100px; }
      .row { flex-grow: 1; }
    `);
    const engine = new FlexLayoutEngine();
    const tree = {
      style: resolveUiStyle(rules, node({ classes: ['panel'] })),
      children: [{ style: resolveUiStyle(rules, node({ classes: ['row'] })), children: [] }],
    };
    const result = engine.compute(tree, { width: 200, height: 100 });
    // content box 180×80 at padding (10,10); the single flex-grow row fills it.
    expect(result.children[0]!.rect).toEqual({ x: 10, y: 10, width: 180, height: 80 });
  });
});
