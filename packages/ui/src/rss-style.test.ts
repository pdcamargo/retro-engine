import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';

import { Disabled } from './interaction/ui-button';
import { UiInteraction } from './interaction/ui-interaction';
import { parseRss } from './rss-parser';
import { collectThemeVars, parseColor, resolveUiStyle, substituteVars } from './rss-resolve';
import { resolveUiStyles, UiClass, UiStyleSheet, UiTheme } from './rss-style';
import { UiNode } from './ui-node';

const rgba = (v: { [i: number]: number } | undefined): number[] =>
  v === undefined ? [] : [v[0]!, v[1]!, v[2]!, v[3]!];

/** Compare an RGBA color channel-by-channel (values are stored as Float32). */
const expectColor = (v: { [i: number]: number } | undefined, expected: number[]): void => {
  const a = rgba(v);
  expect(a).toHaveLength(4);
  expected.forEach((x, i) => expect(a[i]!).toBeCloseTo(x, 5));
};

describe('parseColor', () => {
  it('parses hex in 3/4/6/8-digit forms', () => {
    expect(rgba(parseColor('#f00'))).toEqual([1, 0, 0, 1]);
    expect(rgba(parseColor('#ff0000'))).toEqual([1, 0, 0, 1]);
    const short = rgba(parseColor('#f008'));
    expect(short.slice(0, 3)).toEqual([1, 0, 0]);
    expect(short[3]).toBeCloseTo(0x88 / 255, 5);
    const long = rgba(parseColor('#00ff0080'));
    expect(long.slice(0, 3)).toEqual([0, 1, 0]);
    expect(long[3]).toBeCloseTo(0x80 / 255, 5);
  });

  it('parses rgb()/rgba() with 0–255 channels and 0–1 alpha', () => {
    const c = rgba(parseColor('rgb(255, 128, 0)'));
    expect(c[0]).toBe(1);
    expect(c[1]).toBeCloseTo(128 / 255, 5);
    expect(c[2]).toBe(0);
    expect(c[3]).toBe(1);
    expect(rgba(parseColor('rgba(255,0,0,0.5)'))[3]).toBeCloseTo(0.5, 5);
  });

  it('parses named colors and returns undefined for junk', () => {
    expect(rgba(parseColor('white'))).toEqual([1, 1, 1, 1]);
    expect(rgba(parseColor('transparent'))).toEqual([0, 0, 0, 0]);
    expect(parseColor('not-a-color')).toBeUndefined();
    expect(parseColor('#12')).toBeUndefined();
  });
});

describe('resolveUiStyle — paint properties', () => {
  it('maps background-color / border-width / border-color onto the style', () => {
    const rules = parseRss(
      '.panel { width: 100; height: 50; background-color: #ff0000; border-width: 2; border-color: rgb(0,255,0); }',
    );
    const style = resolveUiStyle(rules, { classes: ['panel'], states: [] });
    expect(style.width).toBe(100);
    expect(style.height).toBe(50);
    expectColor(style.backgroundColor, [1, 0, 0, 1]);
    expect(style.borderWidth).toEqual({ left: 2, right: 2, top: 2, bottom: 2 });
    expectColor(style.borderColor, [0, 1, 0, 1]);
  });

  it('parses the `border` shorthand (width + color, ignoring the style keyword)', () => {
    const rules = parseRss('.b { border: 3 solid #0000ff; }');
    const style = resolveUiStyle(rules, { classes: ['b'], states: [] });
    expect(style.borderWidth).toEqual({ left: 3, right: 3, top: 3, bottom: 3 });
    expectColor(style.borderColor, [0, 0, 1, 1]);
  });

  it('parses the `border` shorthand with a functional color (internal spaces)', () => {
    const rules = parseRss('.b { border: 2 solid rgb(200, 220, 255); }');
    const style = resolveUiStyle(rules, { classes: ['b'], states: [] });
    expect(style.borderWidth).toEqual({ left: 2, right: 2, top: 2, bottom: 2 });
    expectColor(style.borderColor, [200 / 255, 220 / 255, 1, 1]);
  });
});

describe('resolveUiStyles — ECS integration', () => {
  const sheet = new UiStyleSheet(
    parseRss(`
      .box { width: 80; height: 20; background-color: #101010; }
      .box:hovered { background-color: #ff0000; }
      .box:disabled { background-color: #808080; }
      #hud { width: 200; }
      Panel { gap: 5; }
    `),
  );

  const bgColor = (world: World, e: number): { [i: number]: number } | undefined =>
    world.getComponent(e as never, UiNode)!.style.backgroundColor;

  it('resolves .class rules onto a node and reacts to live pseudo-class state', () => {
    const world = new World();
    const e = world.spawn(new UiNode(), new UiClass({ classes: ['box'] }));

    resolveUiStyles(world, world.query([UiNode, UiClass]), sheet);
    expect(world.getComponent(e, UiNode)!.style.width).toBe(80);
    expectColor(bgColor(world, e), [16 / 255, 16 / 255, 16 / 255, 1]);

    // Hover → the :hovered rule wins.
    world.entity(e).insert(new UiInteraction('hovered'));
    resolveUiStyles(world, world.query([UiNode, UiClass]), sheet);
    expectColor(bgColor(world, e), [1, 0, 0, 1]);

    // Remove hover → back to the base rule (style is re-resolved from scratch each pass).
    world.getComponent(e, UiInteraction)!.state = 'none';
    resolveUiStyles(world, world.query([UiNode, UiClass]), sheet);
    expectColor(bgColor(world, e), [16 / 255, 16 / 255, 16 / 255, 1]);
  });

  it('applies the :disabled state from the Disabled marker', () => {
    const world = new World();
    const e = world.spawn(new UiNode(), new UiClass({ classes: ['box'] }), new Disabled());
    resolveUiStyles(world, world.query([UiNode, UiClass]), sheet);
    expectColor(bgColor(world, e), [128 / 255, 128 / 255, 128 / 255, 1]);
  });

  it('matches #name and bare type selectors', () => {
    const world = new World();
    const named = world.spawn(new UiNode(), new UiClass({ name: 'hud' }));
    const typed = world.spawn(new UiNode(), new UiClass({ type: 'Panel' }));
    resolveUiStyles(world, world.query([UiNode, UiClass]), sheet);
    expect(world.getComponent(named, UiNode)!.style.width).toBe(200);
    expect(world.getComponent(typed, UiNode)!.style.gap).toBe(5);
  });

  it('leaves an unmatched node at default style', () => {
    const world = new World();
    const e = world.spawn(new UiNode(), new UiClass({ classes: ['nope'] }));
    resolveUiStyles(world, world.query([UiNode, UiClass]), sheet);
    const style = world.getComponent(e, UiNode)!.style;
    expect(style.backgroundColor).toBeUndefined();
    expect(style.width).toBeUndefined();
  });
});

describe('custom properties (--vars / var())', () => {
  it('collects --vars across the sheet, last-wins', () => {
    const vars = collectThemeVars(
      parseRss(':root { --accent: #ff0000; --gap: 8; } .x { --accent: #00ff00; }'),
    );
    expect(vars['--gap']).toBe('8');
    expect(vars['--accent']).toBe('#00ff00'); // later declaration wins
  });

  it('substitutes var() with a value or fallback', () => {
    const vars = { '--accent': 'rgb(10, 20, 30)' };
    expect(substituteVars('var(--accent)', vars)).toBe('rgb(10, 20, 30)');
    expect(substituteVars('var(--missing, 12)', vars)).toBe('12');
    expect(substituteVars('var(--missing)', vars)).toBe('');
    expect(substituteVars('16', vars)).toBe('16'); // no var() → untouched
  });

  it('resolveUiStyle applies sheet --vars in declaration values', () => {
    const rules = parseRss(`
      :root { --accent: #ff0000; --pad: 10; }
      .card { background-color: var(--accent); padding: var(--pad); width: var(--w, 64); }
    `);
    const style = resolveUiStyle(rules, { classes: ['card'], states: [] });
    expectColor(style.backgroundColor, [1, 0, 0, 1]);
    expect(style.padding).toEqual({ left: 10, right: 10, top: 10, bottom: 10 });
    expect(style.width).toBe(64); // fallback used (no --w)
  });

  it('a UiTheme resource overrides sheet --vars at runtime', () => {
    const themed = new UiStyleSheet(
      parseRss(':root { --accent: #ff0000; } .card { background-color: var(--accent); }'),
    );
    const world = new World();
    const e = world.spawn(new UiNode(), new UiClass({ classes: ['card'] }));

    resolveUiStyles(world, world.query([UiNode, UiClass]), themed);
    expectColor(world.getComponent(e, UiNode)!.style.backgroundColor, [1, 0, 0, 1]);

    // Override the accent via the theme resource → re-resolves to the new value.
    resolveUiStyles(world, world.query([UiNode, UiClass]), themed, new UiTheme({ '--accent': '#0000ff' }));
    expectColor(world.getComponent(e, UiNode)!.style.backgroundColor, [0, 0, 1, 1]);
  });
});
