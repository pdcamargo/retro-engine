// Template spawn & patch — content-scaling cost of expanding a template into an
// entity at level-load scale: param resolution + build + Required Components +
// command-buffer insert, for spawn (fresh entity) and patch (existing entity).
// See docs/adr/ADR-0067.

import { bench, summary } from 'mitata';

import type { Entity } from '@retro-engine/ecs';
import { vec3 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';
import {
  App,
  applyTemplate,
  defineTemplate,
  spawnTemplate,
  Transform,
  Visibility,
} from '@retro-engine/engine';

import { makeHeadlessRenderer, silentLogger } from './helpers';

class Health {
  constructor(
    public current = 0,
    public max = 0,
  ) {}
}

const Mob = defineTemplate({
  name: 'Mob',
  params: {
    position: t.vec3.default(() => vec3.create(0, 0, 0)),
    hp: t.number.default(() => 100),
  },
  build: ({ position, hp }) => [
    new Transform(position),
    new Visibility('Visible'),
    new Health(hp, hp),
  ],
});

const COUNTS = [100, 1_000] as const;

for (const n of COUNTS) {
  summary(() => {
    // Fresh App per iteration so spawned entities don't accumulate across runs.
    bench(`spawnTemplate × ${n}`, function* () {
      yield () => {
        const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
        for (let i = 0; i < n; i += 1) spawnTemplate(app, Mob, { hp: i });
      };
    });

    // App + entities built once; each run re-patches the same entities (insert
    // overwrites in place, so the entity set does not grow between runs).
    bench(`applyTemplate × ${n}`, function* () {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      const entities: Entity[] = [];
      for (let i = 0; i < n; i += 1) entities.push(spawnTemplate(app, Mob, { hp: 100 }));
      yield () => {
        for (const e of entities) applyTemplate(app, e, Mob, { hp: 50 });
      };
    });
  });
}
