// Stage-runner throughput and the cost of per-system profiling instrumentation.
// Compares runStage with profiling off vs on across system counts, so the
// timing wrap added for the studio Systems panel stays cheap. See docs/adr/ADR-0086.

import { bench, summary } from 'mitata';

import { App } from '@retro-engine/engine';
import type { SystemId } from '@retro-engine/engine';

import { type RegisteredSystem, runStage, StageSystems, topoSort } from '../src/schedule';

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

// A fully chained batch (ADR-0157): every system carries one identity-based
// `afterIds` edge to its predecessor — the worst-case linear dependency graph
// the topo sort re-runs on each registration. Isolates the id-edge cost.
const makeChainedSystems = (count: number): RegisteredSystem[] => {
  const out: RegisteredSystem[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = (2_000_000 + i) as SystemId;
    out.push({
      id,
      params: [],
      fn: () => undefined,
      name: `chain-sys-${i}`,
      origin: 'user',
      originPlugin: null,
      ...(i > 0 ? { afterIds: [(2_000_000 + i - 1) as SystemId] } : {}),
    });
  }
  return out;
};

// A stage split across a few sets with set-level ordering (ADR-0158): every
// member gets its set's before/after expanded onto it. Exercises the set-edge
// expansion (members × targets) the topo sort runs on each (re)sort.
const makeSetSystems = (count: number): { systems: RegisteredSystem[]; sets: Map<string, { before?: string[]; after?: string[] }> } => {
  const setNames = ['input', 'sim', 'render-prep'];
  const systems: RegisteredSystem[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = (3_000_000 + i) as SystemId;
    systems.push({
      id,
      params: [],
      fn: () => undefined,
      name: `set-sys-${i}`,
      origin: 'user',
      originPlugin: null,
      sets: [setNames[i % setNames.length]!],
    });
  }
  const sets = new Map<string, { before?: string[]; after?: string[] }>([
    ['sim', { after: ['input'], before: ['render-prep'] }],
  ]);
  return { systems, sets };
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

for (const count of counts) {
  summary(() => {
    bench(`topoSort (chain of ${count})`, function* () {
      const systems = makeChainedSystems(count);
      yield () => topoSort(systems);
    });

    bench(`topoSort (${count} systems in sets)`, function* () {
      const { systems, sets } = makeSetSystems(count);
      yield () => topoSort(systems, sets);
    });
  });
}
