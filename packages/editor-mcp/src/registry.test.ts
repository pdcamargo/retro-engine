import { describe, expect, test } from 'bun:test';

import { reqEntity, reqNumber } from './args';
import type { CommandContext } from './context';
import { CommandRegistry, defineCommand } from './registry';

const fakeCtx = (evalOn: boolean): CommandContext => ({ allowEval: () => evalOn }) as unknown as CommandContext;

const cmd = (name: string, extra: Partial<Parameters<typeof defineCommand>[0]> = {}) =>
  defineCommand({
    name,
    title: name,
    description: name,
    domain: 'test',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: () => null,
    ...extra,
  });

describe('CommandRegistry', () => {
  test('add / get / list', () => {
    const reg = new CommandRegistry();
    const a = cmd('a.one');
    reg.add(a);
    expect(reg.get('a.one')).toBe(a);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('missing')).toBeUndefined();
  });

  test('manifest filters by availability', () => {
    const reg = new CommandRegistry().addAll([cmd('always'), cmd('gated', { available: (c) => c.allowEval() })]);
    expect(reg.manifest(fakeCtx(false)).map((m) => m.name)).toEqual(['always']);
    expect(
      reg
        .manifest(fakeCtx(true))
        .map((m) => m.name)
        .sort(),
    ).toEqual(['always', 'gated']);
  });
});

describe('arg helpers', () => {
  test('reqEntity requires a non-negative integer', () => {
    expect(reqEntity({ entity: 3 })).toBe(3 as unknown as ReturnType<typeof reqEntity>);
    expect(() => reqEntity({})).toThrow();
    expect(() => reqEntity({ entity: -1 })).toThrow();
    expect(() => reqEntity({ entity: 1.5 })).toThrow();
  });

  test('reqNumber rejects non-numbers', () => {
    expect(reqNumber({ n: 2 }, 'n')).toBe(2);
    expect(() => reqNumber({ n: 'x' }, 'n')).toThrow();
  });
});
