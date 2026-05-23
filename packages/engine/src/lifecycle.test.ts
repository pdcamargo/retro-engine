import { describe, expect, it } from 'bun:test';

import type {
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
} from '@retro-engine/renderer-core';
import type { Entity } from '@retro-engine/ecs';

import {
  App,
  Children,
  Commands,
  type HookCtx,
  Lifecycle,
  type Logger,
  Trigger,
} from './index';

const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (): ShaderModule => fail('createShaderModule'),
  createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
  createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
  submit: (): void => fail('submit'),
});

interface SpyLogger {
  readonly logger: Logger;
  readonly devWarns: string[];
}

const createSpyLogger = (): SpyLogger => {
  const devWarns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    devWarn: (m) => {
      devWarns.push(m);
    },
    child: () => logger,
  };
  return { logger, devWarns };
};

class Sprite {
  constructor(public src = '') {}
}

class Slot {
  constructor(public n = 0) {}
}

class Tag {}

class Other {}

describe('Lifecycle.onX(Comp) identity', () => {
  it('Lifecycle.onAdd(Sprite) === Lifecycle.onAdd(Sprite) — cached per (kind, ctor)', () => {
    expect(Lifecycle.onAdd(Sprite)).toBe(Lifecycle.onAdd(Sprite));
    expect(Lifecycle.onInsert(Sprite)).toBe(Lifecycle.onInsert(Sprite));
    expect(Lifecycle.onReplace(Sprite)).toBe(Lifecycle.onReplace(Sprite));
    expect(Lifecycle.onRemove(Sprite)).toBe(Lifecycle.onRemove(Sprite));
  });

  it('different kinds for the same type yield disjoint classes', () => {
    expect(Lifecycle.onAdd(Sprite)).not.toBe(Lifecycle.onInsert(Sprite));
    expect(Lifecycle.onAdd(Sprite)).not.toBe(Lifecycle.onReplace(Sprite));
    expect(Lifecycle.onAdd(Sprite)).not.toBe(Lifecycle.onRemove(Sprite));
  });

  it('different types for the same kind yield disjoint classes', () => {
    expect(Lifecycle.onAdd(Sprite)).not.toBe(Lifecycle.onAdd(Other));
    expect(Lifecycle.onRemove(Sprite)).not.toBe(Lifecycle.onRemove(Other));
  });

  it('class name encodes (kind, type) for debuggability', () => {
    expect(Lifecycle.onAdd(Sprite).name).toBe('onAdd<Sprite>');
    expect(Lifecycle.onRemove(Slot).name).toBe('onRemove<Slot>');
  });
});

describe('Lifecycle.onAdd', () => {
  it('global observer fires once on spawn of a tagged entity, with the just-installed value', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let received: { entity: Entity; src: string } | undefined;

    app.addObserver(
      Lifecycle.onAdd(Sprite),
      [Trigger(Lifecycle.onAdd(Sprite))],
      (t) => {
        const evt = t.event();
        received = { entity: t.entity()!, src: evt.value.src };
      },
    );

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Sprite('hero.png')).id;
    });
    app.advanceFrame(0);

    expect(received).toBeDefined();
    expect(received?.entity).toBe(target!);
    expect(received?.src).toBe('hero.png');
  });

  it('does NOT fire on re-insert when the type was already present', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let addCount = 0;
    app.addObserver(
      Lifecycle.onAdd(Slot),
      [Trigger(Lifecycle.onAdd(Slot))],
      () => {
        addCount += 1;
      },
    );

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Slot(1)).id;
    });
    app.advanceFrame(0);
    expect(addCount).toBe(1);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new Slot(2));
    });
    app.advanceFrame(16);
    expect(addCount).toBe(1);
  });
});

describe('Lifecycle.onInsert', () => {
  it('global observer fires on both spawn and re-insert (superset of onAdd)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let insertCount = 0;
    app.addObserver(
      Lifecycle.onInsert(Slot),
      [Trigger(Lifecycle.onInsert(Slot))],
      () => {
        insertCount += 1;
      },
    );

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Slot(1)).id;
    });
    app.advanceFrame(0);
    expect(insertCount).toBe(1);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new Slot(2));
    });
    app.advanceFrame(16);
    expect(insertCount).toBe(2);
  });
});

describe('Lifecycle.onReplace', () => {
  it('global observer fires only on in-place replace and receives the OLD value', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const replaceTrace: number[] = [];
    app.addObserver(
      Lifecycle.onReplace(Slot),
      [Trigger(Lifecycle.onReplace(Slot))],
      (t) => {
        replaceTrace.push(t.event().value.n);
      },
    );

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Slot(1)).id;
    });
    app.advanceFrame(0);
    // No replace on initial spawn.
    expect(replaceTrace).toEqual([]);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new Slot(2));
    });
    app.advanceFrame(16);
    // Observer received the OLD value (n=1), not the new one.
    expect(replaceTrace).toEqual([1]);
  });
});

describe('Lifecycle.onRemove', () => {
  it('global observer fires once per removal and receives the about-to-be-removed value; storage still holds it inside observer body', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observedValue: Slot | undefined;
    let storageStillHasValue = false;
    let storageStillHasValueN = -1;

    app.addObserver(
      Lifecycle.onRemove(Slot),
      [Trigger(Lifecycle.onRemove(Slot))],
      (t) => {
        observedValue = t.event().value;
        const live = app.world.getComponent(t.entity()!, Slot);
        if (live !== undefined) {
          storageStillHasValue = true;
          storageStillHasValueN = live.n;
        }
      },
    );

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Slot(42)).id;
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).remove(Slot);
    });
    app.advanceFrame(16);

    expect(observedValue?.n).toBe(42);
    expect(storageStillHasValue).toBe(true);
    expect(storageStillHasValueN).toBe(42);
  });

  it('global observer also fires per-component during the despawn fan-out', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let removed = 0;
    app.addObserver(
      Lifecycle.onRemove(Sprite),
      [Trigger(Lifecycle.onRemove(Sprite))],
      () => {
        removed += 1;
      },
    );

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Sprite('a.png')).id;
    });
    app.advanceFrame(0);
    expect(removed).toBe(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(target!);
    });
    app.advanceFrame(16);
    expect(removed).toBe(1);
  });
});

describe('Entity-targeted lifecycle observers', () => {
  it('fires only when the bound entity sees the matching lifecycle moment, not for other entities', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed = 0;
    let bound: Entity | undefined;
    let other: Entity | undefined;

    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn(new Tag());
      bound = e.id;
      e.observe(Lifecycle.onRemove(Tag), [Trigger(Lifecycle.onRemove(Tag))], () => {
        observed += 1;
      });
      const o = cmd.spawn(new Tag());
      other = o.id;
    });
    app.advanceFrame(0);
    expect(observed).toBe(0);

    // Remove Tag from the OTHER entity — bound observer must NOT fire.
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(other!).remove(Tag);
    });
    app.advanceFrame(16);
    expect(observed).toBe(0);

    // Remove Tag from the bound entity — bound observer fires.
    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(bound!).remove(Tag);
    });
    app.advanceFrame(32);
    expect(observed).toBe(1);
  });

  it('entity-targeted observer fires DURING the despawn fan-out of its own entity, then is cleared (no double-fire)', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observed = 0;
    let bound: Entity | undefined;

    app.addSystem('startup', [Commands], (cmd) => {
      const e = cmd.spawn(new Tag());
      bound = e.id;
      e.observe(Lifecycle.onRemove(Tag), [Trigger(Lifecycle.onRemove(Tag))], () => {
        observed += 1;
      });
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(bound!);
    });
    app.advanceFrame(16);
    // Targeted observer fired exactly once for the Tag-removal step of the
    // despawn fan-out — before observerRegistry.clearTargetedFor ran.
    expect(observed).toBe(1);

    // Subsequent frames cannot re-fire the dropped observer.
    app.advanceFrame(32);
    expect(observed).toBe(1);
  });
});

describe('Observer-before-hook ordering for the same (kind, type)', () => {
  it('observer fires BEFORE the component hook for the same removal moment', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    const trace: string[] = [];

    app.addObserver(
      Lifecycle.onRemove(Slot),
      [Trigger(Lifecycle.onRemove(Slot))],
      () => trace.push('observer'),
    );
    app.registerComponentHook(Slot, 'onRemove', (_ctx: HookCtx<Slot>) => {
      trace.push('hook');
    });

    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Slot(1)).id;
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).remove(Slot);
    });
    app.advanceFrame(16);

    expect(trace).toEqual(['observer', 'hook']);
  });
});

describe('Cascade interaction (ADR-0014 + ADR-0015 ordering rule)', () => {
  it('Lifecycle.onRemove(Children) observer fires BEFORE the cascade-driving hook — observer sees the live subtree', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    let observedChildren: Entity[] | undefined;
    let observedChildrenAlive: boolean[] | undefined;

    app.addObserver(
      Lifecycle.onRemove(Children),
      [Trigger(Lifecycle.onRemove(Children))],
      (t) => {
        const evt = t.event();
        observedChildren = [...evt.value.entities];
        observedChildrenAlive = evt.value.entities.map((c) => app.world.hasEntity(c));
      },
    );

    let parent: Entity | undefined;
    let child1: Entity | undefined;
    let child2: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const p = cmd.spawn();
      p.withChildren((b) => {
        child1 = b.spawn().id;
        child2 = b.spawn().id;
      });
      parent = p.id;
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(parent!);
    });
    app.advanceFrame(16);

    // Observer captured the live child list at the moment Children was being removed.
    expect(observedChildren).toEqual([child1!, child2!]);
    // At observer time (before the cascade hook ran), children were still alive.
    expect(observedChildrenAlive).toEqual([true, true]);
    // The cascade still tore the subtree down.
    expect(app.world.hasEntity(parent!)).toBe(false);
    expect(app.world.hasEntity(child1!)).toBe(false);
    expect(app.world.hasEntity(child2!)).toBe(false);
  });
});

describe('Re-entrant lifecycle chains', () => {
  it('lifecycle observer that spawns another tagged entity chains in the same flush without hitting MAX_TRIGGER_DEPTH', () => {
    const spy = createSpyLogger();
    const app = new App({ renderer: makeHeadlessRenderer(), logger: spy.logger });

    class Cascade {
      constructor(public n = 0) {}
    }

    let count = 0;
    const MAX = 12; // > MAX_TRIGGER_DEPTH (8) — would devWarn if lifecycle dispatch consumed depth slots
    app.addObserver(
      Lifecycle.onAdd(Cascade),
      [Trigger(Lifecycle.onAdd(Cascade)), Commands],
      (_t, cmd) => {
        count += 1;
        if (count < MAX) cmd.spawn(new Cascade(count));
      },
    );

    app.addSystem('update', [Commands], (cmd) => cmd.spawn(new Cascade(0)));
    app.advanceFrame(0);

    expect(count).toBe(MAX);
    expect(spy.devWarns).toEqual([]);
  });
});
