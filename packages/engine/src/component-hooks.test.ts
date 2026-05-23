import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import { App, Commands, type HookCtx } from './index';

import { makeHeadlessRenderer } from './test-utils';

class Tag {}

describe('Class-static onAdd hook', () => {
  it('fires when a component is first attached to an entity', () => {
    const trace: string[] = [];
    class Marker {
      static onAdd(ctx: HookCtx<Marker>): void {
        trace.push(`onAdd:${ctx.entity}`);
      }
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Marker());
    });
    app.advanceFrame(0);
    expect(trace.length).toBe(1);
  });

  it('does NOT fire on re-insert when the type was already present (replace-in-place)', () => {
    let addCount = 0;
    class Replaceable {
      static onAdd(_ctx: HookCtx<Replaceable>): void {
        addCount += 1;
      }
      constructor(public n = 0) {}
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Replaceable(1)).id;
    });
    app.advanceFrame(0);
    expect(addCount).toBe(1);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new Replaceable(2));
    });
    app.advanceFrame(16);
    // Same type, replace-in-place — onAdd does NOT re-fire.
    expect(addCount).toBe(1);
  });
});

describe('onInsert hook', () => {
  it('fires on every insert pass, including re-insert', () => {
    let insertCount = 0;
    class Sometype {
      static onInsert(_ctx: HookCtx<Sometype>): void {
        insertCount += 1;
      }
      constructor(public n = 0) {}
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Sometype(1)).id;
    });
    app.advanceFrame(0);
    expect(insertCount).toBe(1);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new Sometype(2));
    });
    app.advanceFrame(16);
    expect(insertCount).toBe(2);
  });
});

describe('onReplace hook', () => {
  it('fires only on in-place replace, with the OLD value', () => {
    let replaceTrace: number[] = [];
    class Slot {
      static onReplace(ctx: HookCtx<Slot>): void {
        replaceTrace.push(ctx.value.n);
      }
      constructor(public n = 0) {}
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new Slot(7)).id;
    });
    app.advanceFrame(0);
    // First insert (during spawn) is not a replace.
    expect(replaceTrace).toEqual([]);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new Slot(8));
    });
    app.advanceFrame(16);
    // The new value (8) replaced the old (7); onReplace sees the OLD value.
    expect(replaceTrace).toEqual([7]);
  });
});

describe('onRemove hook', () => {
  it('fires on removeComponent, pre-mutation, with the about-to-be-removed value', () => {
    let removeTrace: Array<{ entity: number; hp: number; stillThere: boolean }> = [];
    class HP {
      static onRemove(ctx: HookCtx<HP>): void {
        removeTrace.push({
          entity: ctx.entity,
          hp: ctx.value.hp,
          stillThere: ctx.world.has(ctx.entity, HP),
        });
      }
      constructor(public hp = 100) {}
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new HP(55)).id;
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).remove(HP);
    });
    app.advanceFrame(16);

    expect(removeTrace.length).toBe(1);
    expect(removeTrace[0]?.hp).toBe(55);
    // Pre-mutation: the value is still on the entity at hook time.
    expect(removeTrace[0]?.stillThere).toBe(true);
    // After the flush completes, the component is gone.
    expect(app.world.has(target!, HP)).toBe(false);
  });

  it('fans out per-component at despawn — one onRemove call per component', () => {
    let aRemoved = 0;
    let bRemoved = 0;
    class A {
      static onRemove(): void {
        aRemoved += 1;
      }
    }
    class B {
      static onRemove(): void {
        bRemoved += 1;
      }
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new A(), new B()).id;
    });
    app.advanceFrame(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(target!);
    });
    app.advanceFrame(16);
    expect(aRemoved).toBe(1);
    expect(bRemoved).toBe(1);
  });
});

describe('app.registerComponentHook — plugin-side registry', () => {
  it('fires after the class-static hook (if any), in registration order', () => {
    const trace: string[] = [];
    class Watched {
      static onAdd(_ctx: HookCtx<Watched>): void {
        trace.push('static');
      }
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerComponentHook(Watched, 'onAdd', () => trace.push('registry-1'));
    app.registerComponentHook(Watched, 'onAdd', () => trace.push('registry-2'));

    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Watched());
    });
    app.advanceFrame(0);
    expect(trace).toEqual(['static', 'registry-1', 'registry-2']);
  });

  it('works with no class-static hook — registry entries fire alone', () => {
    const trace: string[] = [];
    class PlainTag {}
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerComponentHook(PlainTag, 'onAdd', () => trace.push('hook'));

    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new PlainTag());
    });
    app.advanceFrame(0);
    expect(trace).toEqual(['hook']);
  });
});

describe('HookCtx exposes Commands handle keyed to the triggering system buffer', () => {
  it('hook-enqueued ops fire later in the same flush', () => {
    let secondaryEntityId: Entity | undefined;
    class Trigger {
      static onAdd(ctx: HookCtx<Trigger>): void {
        const e = ctx.commands.spawn(new Tag());
        secondaryEntityId = e.id;
      }
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addSystem('update', [Commands], (cmd) => {
      cmd.spawn(new Trigger());
    });
    app.advanceFrame(0);
    expect(secondaryEntityId).toBeDefined();
    expect(app.world.hasEntity(secondaryEntityId!)).toBe(true);
    expect(app.world.has(secondaryEntityId!, Tag)).toBe(true);
  });
});

describe('Direct world mutations do NOT fire hooks (v1 limitation, documented)', () => {
  it('world.spawn / world.removeComponent bypass the hook dispatcher', () => {
    let addCount = 0;
    let removeCount = 0;
    class Bypassed {
      static onAdd(): void {
        addCount += 1;
      }
      static onRemove(): void {
        removeCount += 1;
      }
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    const e = app.world.spawn(new Bypassed());
    app.world.removeComponent(e, Bypassed);

    // Hooks live at the commands layer; direct world calls do not fire them.
    expect(addCount).toBe(0);
    expect(removeCount).toBe(0);
  });
});

describe('onRemove cascade — consumer registers a hook that despawns children', () => {
  it('plain cmd.despawn of the root tears down the whole subtree via the hook chain', () => {
    class TreeNode {
      constructor(public children: Entity[] = []) {}
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerComponentHook(TreeNode, 'onRemove', (ctx) => {
      for (const child of ctx.value.children) {
        if (ctx.world.hasEntity(child)) ctx.commands.despawn(child);
      }
    });

    let rootId: Entity | undefined;
    const descendants: Entity[] = [];
    app.addSystem('startup', [Commands], (cmd) => {
      const leafA = cmd.spawn(new TreeNode()).id;
      const leafB = cmd.spawn(new TreeNode()).id;
      const mid = cmd.spawn(new TreeNode([leafA, leafB])).id;
      rootId = cmd.spawn(new TreeNode([mid])).id;
      descendants.push(leafA, leafB, mid);
    });
    app.advanceFrame(0);
    expect(app.world.hasEntity(rootId!)).toBe(true);
    for (const id of descendants) expect(app.world.hasEntity(id)).toBe(true);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(rootId!);
    });
    app.advanceFrame(16);
    expect(app.world.hasEntity(rootId!)).toBe(false);
    for (const id of descendants) expect(app.world.hasEntity(id)).toBe(false);
  });
});

describe('onRemove back-reference cleanup — consumer registers a hook that splices an entity out of its parent', () => {
  it('despawning a member removes its id from the group\'s member list', () => {
    class Group {
      constructor(public members: Entity[] = []) {}
    }
    class MemberOf {
      constructor(public group: Entity) {}
    }
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.registerComponentHook(MemberOf, 'onRemove', (ctx) => {
      const groupEntity = ctx.value.group;
      if (!ctx.world.hasEntity(groupEntity)) return;
      const set = ctx.world.getComponent(groupEntity, Group);
      if (!set) return;
      const i = set.members.indexOf(ctx.entity);
      if (i >= 0) set.members.splice(i, 1);
    });

    let groupId: Entity | undefined;
    let memberId: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      const m = cmd.spawn().id;
      groupId = cmd.spawn(new Group([m])).id;
      cmd.entity(m).insert(new MemberOf(groupId));
      memberId = m;
    });
    app.advanceFrame(0);
    expect(app.world.getComponent(groupId!, Group)?.members).toEqual([memberId!]);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.despawn(memberId!);
    });
    app.advanceFrame(16);
    expect(app.world.hasEntity(memberId!)).toBe(false);
    expect(app.world.getComponent(groupId!, Group)?.members).toEqual([]);
  });
});

describe('Hooks fire on insert when adding new types to an existing entity', () => {
  it('onAdd fires for the new type, onInsert fires for all bundle types', () => {
    let aAdds = 0;
    let aInserts = 0;
    let bAdds = 0;
    let bInserts = 0;
    class A {
      static onAdd(): void {
        aAdds += 1;
      }
      static onInsert(): void {
        aInserts += 1;
      }
    }
    class B {
      static onAdd(): void {
        bAdds += 1;
      }
      static onInsert(): void {
        bInserts += 1;
      }
    }

    const app = new App({ renderer: makeHeadlessRenderer() });
    let target: Entity | undefined;
    app.addSystem('startup', [Commands], (cmd) => {
      target = cmd.spawn(new A()).id;
    });
    app.advanceFrame(0);
    expect(aAdds).toBe(1);
    expect(aInserts).toBe(1);
    expect(bAdds).toBe(0);
    expect(bInserts).toBe(0);

    app.addSystem('update', [Commands], (cmd) => {
      cmd.entity(target!).insert(new A(), new B());
    });
    app.advanceFrame(16);
    // A re-inserted (replace) — onAdd does not refire, onInsert does.
    expect(aAdds).toBe(1);
    expect(aInserts).toBe(2);
    // B newly added.
    expect(bAdds).toBe(1);
    expect(bInserts).toBe(1);
  });
});
