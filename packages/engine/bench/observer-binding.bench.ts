// Observer binding — content-scaling cost of resolving handler names and
// attaching entity-targeted observers at scene load: per-entity registry lookup
// plus the command-buffer observe op, over a scene of N entities that each bind a
// handler by name. See docs/adr/ADR-0068.

import { bench, summary } from 'mitata';

import {
  App,
  defineObserverHandler,
  type SceneData,
  spawnScene,
  Trigger,
} from '@retro-engine/engine';

import { makeHeadlessRenderer, silentLogger } from './helpers';

class Ping {
  constructor(public n = 0) {}
}

const handler = defineObserverHandler({
  name: 'noop',
  event: Ping,
  params: [Trigger(Ping)] as const,
  run: () => undefined,
});

const sceneOf = (n: number): SceneData => ({
  version: 1,
  entities: Array.from({ length: n }, (_unused, id) => ({
    id,
    components: [],
    observers: [{ handler: 'noop' }],
  })),
});

const COUNTS = [100, 1_000] as const;

for (const n of COUNTS) {
  summary(() => {
    const scene = sceneOf(n);
    // Fresh App per iteration so spawned entities don't accumulate across runs.
    bench(`spawnScene observers × ${n}`, function* () {
      yield () => {
        const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
        app.registerObserverHandler(handler);
        spawnScene(app, scene);
      };
    });
  });
}
