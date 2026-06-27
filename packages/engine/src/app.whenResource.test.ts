import { describe, expect, it } from 'bun:test';

import { App } from './index';
import { makeHeadlessRenderer } from './test-utils';

class Later {
  constructor(public readonly tag: string) {}
}

class Other {}

describe('App.whenResource', () => {
  it('runs the callback immediately when the resource is already present', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.insertResource(new Later('present'));

    let seen: Later | undefined;
    app.whenResource(Later, (value) => {
      seen = value;
    });

    expect(seen?.tag).toBe('present');
  });

  it('defers the callback until the resource is first inserted', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let seen: Later | undefined;
    app.whenResource(Later, (value) => {
      seen = value;
    });
    expect(seen).toBeUndefined();

    app.insertResource(new Later('deferred'));
    expect(seen?.tag).toBe('deferred');
  });

  it('fires each waiter once and only for its own resource type', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let laterCalls = 0;
    let otherCalls = 0;
    app.whenResource(Later, () => {
      laterCalls += 1;
    });
    app.whenResource(Other, () => {
      otherCalls += 1;
    });

    app.insertResource(new Later('a'));
    expect(laterCalls).toBe(1);
    expect(otherCalls).toBe(0);

    // Replacing the resource must not re-fire the (already dropped) waiter.
    app.insertResource(new Later('b'));
    expect(laterCalls).toBe(1);
  });

  it('runs every queued waiter for the same type on insert', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    const seen: string[] = [];
    app.whenResource(Later, () => seen.push('one'));
    app.whenResource(Later, () => seen.push('two'));

    app.insertResource(new Later('x'));
    expect(seen).toEqual(['one', 'two']);
  });
});
