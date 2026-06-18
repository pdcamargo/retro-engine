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

describe('History — view', () => {
  it('reports every applied entry oldest-first with the cursor at the tip', () => {
    const { history, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    const view = history.view();
    expect(view.entries.length).toBe(2);
    expect(view.currentIndex).toBe(1);
    expect(view.entries[0]!.kind).toBe('setField');
  });

  it('carries the target + before/after for a setField entry', () => {
    const { history, entity } = setup();
    history.commit(entity, 'Counter', N, 3, 8);
    const entry = history.view().entries[0]!;
    expect(entry.entity).toBe(entity);
    expect(entry.componentName).toBe('Counter');
    expect(entry.field).toBe('n');
    expect(entry.before).toBe(3);
    expect(entry.after).toBe(8);
  });

  it('includes the redoable future after current, in chronological order', () => {
    const { history, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.commit(entity, 'Counter', N, 2, 3);
    history.undo();
    history.undo();
    const view = history.view();
    expect(view.entries.length).toBe(3);
    expect(view.currentIndex).toBe(0);
    expect(view.entries[1]!.after).toBe(2);
    expect(view.entries[2]!.after).toBe(3);
  });

  it('surfaces a batch entry by its label', () => {
    const { history, entity } = setup();
    history.beginBatch('Reset');
    history.commit(entity, 'Counter', N, 0, 10);
    history.endBatch();
    const entry = history.view().entries[0]!;
    expect(entry.kind).toBe('batch');
    expect(entry.label).toBe('Reset');
  });

  it('is empty with a -1 cursor after clear', () => {
    const { history, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.clear();
    const view = history.view();
    expect(view.entries.length).toBe(0);
    expect(view.currentIndex).toBe(-1);
  });
});

describe('History — jumpTo', () => {
  it('jumps backward and forward to an arbitrary entry', () => {
    const { history, target, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.commit(entity, 'Counter', N, 2, 3);
    history.jumpTo(0);
    expect(valueOf(target, entity)).toBe(1);
    expect(history.view().currentIndex).toBe(0);
    history.jumpTo(2);
    expect(valueOf(target, entity)).toBe(3);
    expect(history.view().currentIndex).toBe(2);
  });

  it('jumps to -1 to undo everything', () => {
    const { history, target, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.jumpTo(-1);
    expect(valueOf(target, entity)).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.view().currentIndex).toBe(-1);
  });

  it('clamps an out-of-range index to the timeline', () => {
    const { history, target, entity } = setup();
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.undo();
    history.jumpTo(99);
    expect(valueOf(target, entity)).toBe(2);
    expect(history.view().currentIndex).toBe(1);
  });

  it('fires onChange once for a multi-step jump', () => {
    const registry = new TypeRegistry();
    registry.registerComponent(Counter, { n: t.number }, { name: 'Counter' });
    const world = new World();
    const entity = world.spawn(new Counter());
    let changes = 0;
    const history = new History({ world, registry }, { onChange: () => (changes += 1) });
    history.commit(entity, 'Counter', N, 0, 1);
    history.commit(entity, 'Counter', N, 1, 2);
    history.commit(entity, 'Counter', N, 2, 3);
    changes = 0;
    history.jumpTo(0);
    expect(changes).toBe(1);
  });
});
