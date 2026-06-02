import { describe, expect, it } from 'bun:test';

import { t } from './field-type';
import { TypeRegistry, readField, writeField } from './type-registry';

class Health {
  current = 100;
  max = 100;
}

describe('TypeRegistry', () => {
  it('registers and looks up a component by its stable name', () => {
    const reg = new TypeRegistry();
    const entry = reg.registerComponent(
      Health,
      { current: t.number, max: t.number },
      { name: 'Health' },
    );
    expect(entry.name).toBe('Health');
    expect(entry.attachable).toBe(true);
    expect(reg.get('Health')).toBe(entry);
    expect(reg.getByCtor(Health)).toBe(entry);
    expect(reg.has('Health')).toBe(true);
  });

  it('exposes fields in declaration order for introspection', () => {
    const reg = new TypeRegistry();
    const entry = reg.registerComponent(
      Health,
      { current: t.number, max: t.number },
      { name: 'Health' },
    );
    expect(entry.fields.map(([name]) => name)).toEqual(['current', 'max']);
    expect(entry.fields[0]?.[1].kind).toBe('number');
  });

  it('keys by stable name, not the class name (survives a rename/minification)', () => {
    const reg = new TypeRegistry();
    reg.registerComponent(Health, { current: t.number, max: t.number }, { name: 'Health' });
    // Simulate minification renaming the constructor: the stable name is unchanged.
    Object.defineProperty(Health, 'name', { value: 'q' });
    expect(reg.get('Health')?.name).toBe('Health');
    expect(reg.getByCtor(Health)?.name).toBe('Health');
  });

  it('accepts a static typeName when no explicit name is given', () => {
    class Velocity {
      static readonly typeName = 'Velocity';
      x = 0;
      y = 0;
    }
    const reg = new TypeRegistry();
    const entry = reg.registerComponent(Velocity, { x: t.number, y: t.number });
    expect(entry.name).toBe('Velocity');
  });

  it('throws when no stable name can be resolved', () => {
    class Anonymous {
      value = 1;
    }
    const reg = new TypeRegistry();
    expect(() => reg.registerComponent(Anonymous, { value: t.number })).toThrow(/explicit stable name/);
  });

  it('throws when two constructors claim the same name', () => {
    class A {
      v = 1;
    }
    class B {
      v = 2;
    }
    const reg = new TypeRegistry();
    reg.registerComponent(A, { v: t.number }, { name: 'Same' });
    expect(() => reg.registerComponent(B, { v: t.number }, { name: 'Same' })).toThrow(
      /already registered/,
    );
  });

  it('distinguishes plain registered types from components', () => {
    class Inner {
      n = 0;
    }
    class Outer {
      n = 0;
    }
    const reg = new TypeRegistry();
    reg.registerType(Inner, { n: t.number }, { name: 'Inner' });
    reg.registerComponent(Outer, { n: t.number }, { name: 'Outer' });
    expect([...reg.types()].map((e) => e.name).sort()).toEqual(['Inner', 'Outer']);
    expect([...reg.components()].map((e) => e.name)).toEqual(['Outer']);
  });

  it('reads and writes fields by name', () => {
    const h = new Health();
    expect(readField(h, 'current')).toBe(100);
    writeField(h, 'current', 42);
    expect(h.current).toBe(42);
  });

  it('rejects a malformed schema at compile time (verified by tsc)', () => {
    // These calls run harmlessly at runtime (the registry stores the schema as
    // given); the @ts-expect-error directives are the real assertions — typecheck
    // fails if any expected compile error is missing. Each call is one line so the
    // suppressed error lands on the line the directive guards.
    // @ts-expect-error — missing field 'max'
    new TypeRegistry().registerComponent(Health, { current: t.number }, { name: 'H1' });
    // @ts-expect-error — 'current' is a number, not a string
    new TypeRegistry().registerComponent(Health, { current: t.string, max: t.number }, { name: 'H2' });
    // @ts-expect-error — 'extra' not a field of Health
    new TypeRegistry().registerComponent(Health, { current: t.number, max: t.number, extra: t.number }, { name: 'H3' });
    expect(true).toBe(true);
  });
});
