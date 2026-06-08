import { describe, expect, it } from 'bun:test';

import {
  App,
  Commands,
  defineObserverHandler,
  type SceneData,
  spawnScene,
  Trigger,
} from '../index';
import { makeHeadlessRenderer } from '../test-utils';

class Ping {
  constructor(public n = 0) {}
}

/** Force a scene through JSON so the test proves it is plain, serializable data. */
const roundTrip = (scene: SceneData): SceneData => JSON.parse(JSON.stringify(scene)) as SceneData;

describe('spawnScene — observer bindings', () => {
  it('attaches a scene-bound handler that fires when its event is triggered', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const received: number[] = [];
    app.registerObserverHandler(
      defineObserverHandler({
        name: 'record',
        event: Ping,
        params: [Trigger(Ping)] as const,
        run: (trigger) => received.push(trigger.event().n),
      }),
    );

    const entity = spawnScene(app, {
      version: 1,
      entities: [{ id: 0, components: [], observers: [{ handler: 'record' }] }],
    }).get(0)!;

    app.addSystem('update', [Commands], (cmd) => cmd.entity(entity).trigger(new Ping(7)));
    app.advanceFrame(0);
    expect(received).toEqual([7]);
  });

  it('round-trips a binding through JSON into a live, firing observer', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const received: number[] = [];
    app.registerObserverHandler(
      defineObserverHandler({
        name: 'record',
        event: Ping,
        params: [Trigger(Ping)] as const,
        run: (trigger) => received.push(trigger.event().n),
      }),
    );

    const scene = roundTrip({
      version: 1,
      entities: [{ id: 0, components: [], observers: [{ handler: 'record' }] }],
    });
    const entity = spawnScene(app, scene).get(0)!;

    app.addSystem('update', [Commands], (cmd) => cmd.entity(entity).trigger(new Ping(99)));
    app.advanceFrame(0);
    expect(received).toEqual([99]);
  });

  it('throws when a binding names an unregistered handler', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const scene = roundTrip({
      version: 1,
      entities: [{ id: 0, components: [], observers: [{ handler: 'Ghost' }] }],
    });
    expect(() => spawnScene(app, scene)).toThrow(/unregistered observer handler 'Ghost'/);
  });

  it('drops a scene-bound observer when its entity is despawned', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let fired = 0;
    app.registerObserverHandler(
      defineObserverHandler({
        name: 'count',
        event: Ping,
        params: [Trigger(Ping)] as const,
        run: () => {
          fired += 1;
        },
      }),
    );

    const entity = spawnScene(app, {
      version: 1,
      entities: [{ id: 0, components: [], observers: [{ handler: 'count' }] }],
    }).get(0)!;

    let frame = 0;
    app.addSystem('update', [Commands], (cmd) => {
      frame += 1;
      if (frame === 1) {
        cmd.entity(entity).trigger(new Ping());
      } else if (frame === 2) {
        // Despawn is enqueued before the trigger, so its `clearTargetedFor` runs
        // first in the flush — the trigger then finds no targeted observer.
        cmd.entity(entity).despawn();
        cmd.entity(entity).trigger(new Ping());
      }
    });

    app.advanceFrame(0);
    expect(fired).toBe(1); // fired while alive

    app.advanceFrame(16);
    expect(fired).toBe(1); // unchanged: the bound observer was cleared on despawn
  });
});
