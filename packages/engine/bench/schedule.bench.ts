// Stage-runner throughput and the cost of per-system profiling instrumentation.
// Compares runStage with profiling off vs on across system counts, so the
// timing wrap added for the studio Systems panel stays cheap. See docs/adr/ADR-0086.

import { bench, summary } from 'mitata';

import { App } from '@retro-engine/engine';
import type { SystemId } from '@retro-engine/engine';

import { type RegisteredSystem, runStage, StageSystems } from '../src/schedule';

import { makeHeadlessRenderer, silentLogger } from './helpers';

// Synthetic systems with empty params and a trivial body — the runner's
// per-system overhead (param resolve, gate checks, command flush, optional
// timing) dominates, which is exactly what we want to measure.
const makeStage = (count: number): StageSystems => {
  const stage = new StageSystems();
  for (let i = 0; i < count; i += 1) {
    const sys: RegisteredSystem = {
      id: (1_000_000 + i) as SystemId,
      params: [],
      fn: () => undefined,
      name: `bench-sys-${i}`,
      origin: 'user',
      originPlugin: null,
    };
    stage.push(sys);
  }
  return stage;
};

const counts = [16, 64, 256];

for (const count of counts) {
  summary(() => {
    bench(`runStage (profiling off) @ ${count} systems`, function* () {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      const stage = makeStage(count);
      yield () => runStage(stage, app, 'update');
    });

    bench(`runStage (profiling on) @ ${count} systems`, function* () {
      const app = new App({
        renderer: makeHeadlessRenderer(),
        logger: silentLogger,
        profileSystems: true,
      });
      const stage = makeStage(count);
      yield () => runStage(stage, app, 'update');
    });
  });
}
