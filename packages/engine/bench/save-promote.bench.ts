// Project save — content-scaling cost of the save/promote path: serializeProject
// over a scene with N entities + N promoted meshes (one serializer.serialize per
// mesh + manifest bake + scene-doc encode). Save is one-shot at author time, but
// the per-asset serialize cost grows with content, so it gets a bench.
// See docs/adr/ADR-0070.

import { bench, summary } from 'mitata';

import type { Handle } from '@retro-engine/assets';
import { vec3 } from '@retro-engine/math';
import {
  App,
  ASSET_TYPE,
  Cuboid,
  Mesh,
  Mesh3d,
  Meshes,
  serializeProject,
  serializeScene,
  Transform,
} from '@retro-engine/engine';

import { makeHeadlessRenderer, silentLogger } from './helpers';

const COUNTS = [64, 256, 1_024] as const;

const buildApp = (n: number): { app: App; handles: Handle<Mesh>[] } => {
  const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
  const meshes = app.getResource(Meshes)!;
  const handles: Handle<Mesh>[] = [];
  for (let i = 0; i < n; i += 1) {
    const handle = meshes.add(new Cuboid().mesh().build());
    handles.push(handle);
    app.world.spawn(new Mesh3d(handle), new Transform(vec3.create(i, 0, 0)));
  }
  return { app, handles };
};

for (const n of COUNTS) {
  summary(() => {
    bench(`serializeProject × ${n} meshes`, function* () {
      const { app, handles } = buildApp(n);
      const scene = serializeScene(app);
      const promotions = handles.map((handle) => ({
        handle,
        kind: ASSET_TYPE.mesh,
        extension: 'rmesh',
      }));
      yield () => {
        serializeProject(app, {
          scenes: [{ location: 'scenes/main.scene', data: scene }],
          promotions,
        });
      };
    });
  });
}
