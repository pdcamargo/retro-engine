import { describe, expect, it } from 'bun:test';
import { type Entity, World } from '@retro-engine/ecs';
import { TypeRegistry, t } from '@retro-engine/reflect';

import type { EditTarget } from './apply';
import type { ItemEdges } from './emitter';
import type { FieldPath } from './field-path';
import { History } from './history';

class Counter {
  n = 0;
}

const N: FieldPath = [{ kind: 'field', name: 'n' }];
const RELEASED: ItemEdges = { activated: false, deactivatedAfterEdit: true, edited: true };

const setup = (capacity?: number): { history: History; target: EditTarget; entity: Entity } => {
  const registry = new TypeRegistry();
  registry.registerComponent(Counter, { n: t.number }, { name: 'Counter' });
  const world = new World();
  const entity = world.spawn(new Counter());
  const history = new History({ world, registry }, capacity === undefined ? {} : { capacity });
  return { history, target: { world, registry }, entity };
};

const valueOf = (target: EditTarget, entity: Entity): number => target.world.getComponent(entity, Counter)!.n;

describe('History — atomic commit', () => {
  it('applies, undoes, and redoes a single edit', () => {
    const { history, target, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 7);
    expect(valueOf(target, entity)).toBe(7);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(valueOf(target, entity)).toBe(0);
    history.redo();
    expect(valueOf(target, entity)).toBe(7);
  });

  it('records nothing for a no-op edit', () => {
    const { history, entity } = setup();
    history.commit(entity, 'Counter', N, 3, 3);
    expect(history.canUndo).toBe(false);
  });
});

describe('History — coalesced scrub', () => {
  it('collapses a multi-frame drag into one entry that undoes to the start', () => {
    const { history, target, entity } = setup();
    history.preview(entity, 'Counter', N, 0, 2);
    history.preview(entity, 'Counter', N, 2, 4);
    history.preview(entity, 'Counter', N, 4, 9);
    expect(valueOf(target, entity)).toBe(9);
    expect(history.canUndo).toBe(false); // not committed until the interaction ends
    history.sync(entity, 'Counter', N, RELEASED);
    expect(history.entries().length).toBe(1);
    history.undo();
    expect(valueOf(target, entity)).toBe(0); // back to the pre-drag value, not an intermediate
  });
});

describe('History — fork, capacity, batch', () => {
  it('clears the redo future when a new edit is recorded', () => {
    const { history, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.undo();
    expect(history.canRedo).toBe(true);
    history.commit(entity, 'Counter', N, 1, 5);
    expect(history.canRedo).toBe(false);
  });

  it('drops the oldest entry past capacity', () => {
    const { history, entity } = setup(2);
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.commit(entity, 'Counter', N, 2, 3);
    expect(history.entries().length).toBe(2);
  });

  it('groups a batch into one undoable entry', () => {
    const { history, target, entity } = setup();
    history.beginBatch('Reset');
    history.commit(entity, 'Counter', N, 0, 10);
    history.commit(entity, 'Counter', N, 10, 20);
    history.endBatch();
    expect(history.entries().length).toBe(1);
    expect(valueOf(target, entity)).toBe(20);
    history.undo();
    expect(valueOf(target, entity)).toBe(0);
  });
});
