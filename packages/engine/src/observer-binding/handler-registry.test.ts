import { describe, expect, it } from 'bun:test';

import { Trigger } from '../observers';

import { defineObserverHandler } from './handler';
import { ObserverHandlerRegistry } from './handler-registry';

class Ping {
  constructor(public n = 0) {}
}

const makeHandler = (name: string) =>
  defineObserverHandler({
    name,
    event: Ping,
    params: [Trigger(Ping)] as const,
    run: () => undefined,
  });

describe('ObserverHandlerRegistry', () => {
  it('registers a handler and returns it', () => {
    const registry = new ObserverHandlerRegistry();
    const handler = makeHandler('a');
    expect(registry.register(handler)).toBe(handler);
    expect(registry.get('a')).toBe(handler);
    expect(registry.has('a')).toBe(true);
  });

  it('throws when a name is already registered', () => {
    const registry = new ObserverHandlerRegistry();
    registry.register(makeHandler('dup'));
    expect(() => registry.register(makeHandler('dup'))).toThrow(
      /observer handler named 'dup' is already registered/,
    );
  });

  it('reports unregistered names as absent', () => {
    const registry = new ObserverHandlerRegistry();
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.has('missing')).toBe(false);
  });

  it('iterates every registered handler', () => {
    const registry = new ObserverHandlerRegistry();
    registry.register(makeHandler('a'));
    registry.register(makeHandler('b'));
    expect([...registry.handlers()].map((h) => h.name).sort()).toEqual(['a', 'b']);
  });
});
