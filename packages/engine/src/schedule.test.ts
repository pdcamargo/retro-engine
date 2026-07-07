import { describe, expect, it } from 'bun:test';


import { App, RunCondition, system } from './index';

import { makeHeadlessRenderer } from './test-utils';

describe('Stage union', () => {
  it('runs the Main schedule in order: first → startup (first frame only) → preUpdate → update → postUpdate → last', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('first', [], () => trace.push('first'));
    app.addSystem('startup', [], () => trace.push('startup'));
    app.addSystem('preUpdate', [], () => trace.push('preUpdate'));
    app.addSystem('update', [], () => trace.push('update'));
    app.addSystem('postUpdate', [], () => trace.push('postUpdate'));
    app.addSystem('last', [], () => trace.push('last'));

    app.advanceFrame(0);
    expect(trace).toEqual(['first', 'startup', 'preUpdate', 'update', 'postUpdate', 'last']);

    trace.length = 0;
    app.advanceFrame(16);
    // Startup is first-frame only — second frame skips it.
    expect(trace).toEqual(['first', 'preUpdate', 'update', 'postUpdate', 'last']);
  });

  it('exposes the new fixed* stages on the Stage union (smoke registration)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    // Registering against each fixed* name does not throw; until the fixed
    // driver lands, these stages are simply not driven each frame.
    expect(() => app.addSystem('fixedFirst', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedPreUpdate', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedUpdate', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedPostUpdate', [], () => undefined)).not.toThrow();
    expect(() => app.addSystem('fixedLast', [], () => undefined)).not.toThrow();
  });
});

describe('Ordering within a stage', () => {
  it('respects before / after / label constraints', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    // Register in shuffled order; topo sort must put them back as input → motion → collision.
    app.addSystem('update', [], () => trace.push('collision'), { after: ['motion'] });
    app.addSystem('update', [], () => trace.push('motion'), {
      label: 'motion',
      after: ['input'],
    });
    app.addSystem('update', [], () => trace.push('input'), { label: 'input' });

    app.advanceFrame(0);
    expect(trace).toEqual(['input', 'motion', 'collision']);
  });

  it('falls back to registration order among nodes with no constraints', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('a'));
    app.addSystem('update', [], () => trace.push('b'));
    app.addSystem('update', [], () => trace.push('c'));

    app.advanceFrame(0);
    expect(trace).toEqual(['a', 'b', 'c']);
  });

  it('allows forward references to labels registered later', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('depends-on-later'), { after: ['later'] });
    app.addSystem('update', [], () => trace.push('later'), { label: 'later' });

    app.advanceFrame(0);
    expect(trace).toEqual(['later', 'depends-on-later']);
  });

  it('ignores constraints that reference no matching label', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('a'), { before: ['nonexistent'] });
    app.addSystem('update', [], () => trace.push('b'));

    expect(() => app.advanceFrame(0)).not.toThrow();
    expect(trace).toEqual(['a', 'b']);
  });

  it('throws at registration when a cycle is introduced; offending registration is rolled back', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let aRan = 0;
    let bRan = 0;
    app.addSystem(
      'update',
      [],
      () => {
        aRan += 1;
      },
      { label: 'a', after: ['b'] },
    );
    expect(() =>
      app.addSystem(
        'update',
        [],
        () => {
          bRan += 1;
        },
        { label: 'b', after: ['a'] },
      ),
    ).toThrow(/ordering cycle/);

    // After the throw, only system 'a' remains; it still runs.
    app.advanceFrame(0);
    expect(aRan).toBe(1);
    expect(bRan).toBe(0);
  });

  it('cycle detection is per-stage — same labels in different stages do not interact', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('u-foo'), { label: 'foo' });
    app.addSystem('postUpdate', [], () => trace.push('pu-foo'), { label: 'foo' });
    app.addSystem('postUpdate', [], () => trace.push('pu-bar'), { after: ['foo'] });

    app.advanceFrame(0);
    expect(trace).toEqual(['u-foo', 'pu-foo', 'pu-bar']);
  });

  it('honours runIf gating alongside ordering', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('a'), { label: 'a' });
    app.addSystem('update', [], () => trace.push('b-skipped'), {
      after: ['a'],
      runIf: new RunCondition(() => false),
    });
    app.addSystem('update', [], () => trace.push('c'), { after: ['a'] });

    app.advanceFrame(0);
    expect(trace).toEqual(['a', 'c']);
  });
});

describe('addSystems + chain (ADR-0157)', () => {
  it('registers a batch in array order (no chain is a grouping convenience)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystems('update', [
      system([], () => trace.push('a')),
      system([], () => trace.push('b')),
      system([], () => trace.push('c')),
    ]);

    app.advanceFrame(0);
    expect(trace).toEqual(['a', 'b', 'c']);
  });

  it('chain: each system runs after the previous in the batch', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystems(
      'update',
      [
        system([], () => trace.push('first')),
        system([], () => trace.push('second')),
        system([], () => trace.push('third')),
      ],
      { chain: true },
    );

    app.advanceFrame(0);
    expect(trace).toEqual(['first', 'second', 'third']);
  });

  it('chains by identity — same-labelled systems sequence without a cycle', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    // All three carry the SAME label; a label-keyed `after` would be ambiguous
    // or cyclic. Identity-based chain edges order them 1 → 2 → 3 cleanly.
    app.addSystems(
      'update',
      [
        system([], () => trace.push('1'), { label: 'step' }),
        system([], () => trace.push('2'), { label: 'step' }),
        system([], () => trace.push('3'), { label: 'step' }),
      ],
      { chain: true },
    );

    app.advanceFrame(0);
    expect(trace).toEqual(['1', '2', '3']);
  });

  it('chain composes with a label and an external after constraint', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    // Registered first, but constrained to run after the chained 'b'.
    app.addSystem('update', [], () => trace.push('post'), { after: ['b'] });
    app.addSystems(
      'update',
      [system([], () => trace.push('a')), system([], () => trace.push('b'), { label: 'b' })],
      { chain: true },
    );

    app.advanceFrame(0);
    // chain gives a → b; the label constraint puts post after b.
    expect(trace).toEqual(['a', 'b', 'post']);
  });

  it('detects a cycle when a chain conflicts with a label constraint', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    // chain makes Y run after X (by id); X also declares after:['y'] and Y is
    // labelled 'y' → X after Y and Y after X → cycle, caught at registration.
    expect(() =>
      app.addSystems(
        'update',
        [
          system([], () => undefined, { after: ['y'] }),
          system([], () => undefined, { label: 'y' }),
        ],
        { chain: true },
      ),
    ).toThrow(/ordering cycle/);
  });
});

describe('SystemSet + configureSet (ADR-0158)', () => {
  it('set-level after orders every member of a set after a target', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    // Two physics members, registered before 'input'; the set config puts both
    // after input regardless of registration order.
    app.addSystem('update', [], () => trace.push('integrate'), { inSet: 'physics' });
    app.addSystem('update', [], () => trace.push('contacts'), { inSet: 'physics' });
    app.addSystem('update', [], () => trace.push('input'), { label: 'input' });
    app.configureSet('update', 'physics', { after: ['input'] });

    app.advanceFrame(0);
    expect(trace[0]).toBe('input');
    expect(trace.slice(1).sort()).toEqual(['contacts', 'integrate']);
  });

  it('set-level before orders every member before a target', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('render-prep'), { label: 'render-prep' });
    app.addSystem('update', [], () => trace.push('a'), { inSet: 'sim' });
    app.addSystem('update', [], () => trace.push('b'), { inSet: 'sim' });
    app.configureSet('update', 'sim', { before: ['render-prep'] });

    app.advanceFrame(0);
    expect(trace[trace.length - 1]).toBe('render-prep');
    expect(trace.slice(0, 2).sort()).toEqual(['a', 'b']);
  });

  it('before / after can target a set name (runs relative to the whole set)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('sim-a'), { inSet: 'sim' });
    app.addSystem('update', [], () => trace.push('sim-b'), { inSet: 'sim' });
    // A plain system that just declares `after: ['sim']` runs after both members.
    app.addSystem('update', [], () => trace.push('after-sim'), { after: ['sim'] });

    app.advanceFrame(0);
    expect(trace[trace.length - 1]).toBe('after-sim');
  });

  it('a system in multiple sets inherits both sets’ ordering', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.addSystem('update', [], () => trace.push('early'), { label: 'early' });
    app.addSystem('update', [], () => trace.push('late'), { label: 'late' });
    app.addSystem('update', [], () => trace.push('mid'), { inSet: ['a', 'b'] });
    app.configureSet('update', 'a', { after: ['early'] });
    app.configureSet('update', 'b', { before: ['late'] });

    app.advanceFrame(0);
    expect(trace).toEqual(['early', 'mid', 'late']);
  });

  it('configureSet before its members register (forward reference)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    app.configureSet('update', 'physics', { after: ['input'] });
    app.addSystem('update', [], () => trace.push('step'), { inSet: 'physics' });
    app.addSystem('update', [], () => trace.push('input'), { label: 'input' });

    app.advanceFrame(0);
    expect(trace).toEqual(['input', 'step']);
  });

  it('detects a cycle between two sets and rolls back the offending config', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [], () => undefined, { inSet: 'a' });
    app.addSystem('update', [], () => undefined, { inSet: 'b' });
    app.configureSet('update', 'a', { after: ['b'] });
    // b after a as well → a↔b cycle, thrown here and rolled back.
    expect(() => app.configureSet('update', 'b', { after: ['a'] })).toThrow(/ordering cycle/);
    // The rolled-back config leaves a runnable schedule.
    expect(() => app.advanceFrame(0)).not.toThrow();
  });

  it('set-level runIf gates every member (Phase 2b)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    let enabled = false;
    app.addSystem('update', [], () => trace.push('a'), { inSet: 'gameplay' });
    app.addSystem('update', [], () => trace.push('b'), { inSet: 'gameplay' });
    app.addSystem('update', [], () => trace.push('always'));
    app.configureSet('update', 'gameplay', { runIf: new RunCondition(() => enabled) });

    app.advanceFrame(0);
    expect(trace).toEqual(['always']); // gameplay gated off

    enabled = true;
    trace.length = 0;
    app.advanceFrame(16);
    expect(trace.sort()).toEqual(['a', 'always', 'b']); // gameplay now runs
  });

  it('a member runs only when its own runIf AND the set condition pass', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    let setOn = true;
    let ownOn = true;
    app.addSystem('update', [], () => trace.push('m'), {
      inSet: 'g',
      runIf: new RunCondition(() => ownOn),
    });
    app.configureSet('update', 'g', { runIf: new RunCondition(() => setOn) });

    app.advanceFrame(0);
    expect(trace).toEqual(['m']); // both pass

    trace.length = 0;
    setOn = false;
    app.advanceFrame(16);
    expect(trace).toEqual([]); // set gate fails

    trace.length = 0;
    setOn = true;
    ownOn = false;
    app.advanceFrame(32);
    expect(trace).toEqual([]); // own gate fails
  });

  it('AND-s multiple run conditions configured on the same set', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];
    let a = true;
    let b = true;
    app.addSystem('update', [], () => trace.push('s'), { inSet: 'g' });
    app.configureSet('update', 'g', { runIf: new RunCondition(() => a) });
    app.configureSet('update', 'g', { runIf: new RunCondition(() => b) });

    app.advanceFrame(0);
    expect(trace).toEqual(['s']);

    trace.length = 0;
    b = false;
    app.advanceFrame(16);
    expect(trace).toEqual([]); // second condition fails → gated
  });
});
