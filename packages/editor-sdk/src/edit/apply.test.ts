import { describe, expect, it } from 'bun:test';
import { type Entity, World } from '@retro-engine/ecs';
import type { Vec3 } from '@retro-engine/math';
import { type RegisteredType, TypeRegistry, t } from '@retro-engine/reflect';

import { applyEdit, type EditTarget, revertEdit } from './apply';
import type { AddBundleCommand, AddComponentCommand, SetFieldCommand } from './command';

class Pos {
  v: Vec3 = new Float32Array([1, 2, 3]);
}
class Tag {
  name = 'a';
}

const setup = (): { target: EditTarget; entity: Entity; posReg: RegisteredType; tagReg: RegisteredType } => {
  const registry = new TypeRegistry();
  const posReg = registry.registerComponent(Pos, { v: t.vec3 }, { name: 'Pos' });
  const tagReg = registry.registerComponent(Tag, { name: t.string }, { name: 'Tag' });
  const world = new World();
  const entity = world.spawn(new Pos());
  return { target: { world, registry }, entity, posReg, tagReg };
};

describe('applyEdit / revertEdit — setField', () => {
  it('writes after on apply and restores before on revert', () => {
    const { target, entity } = setup();
    const command: SetFieldCommand = {
      kind: 'setField',
      scope: { kind: 'entity', entity, componentName: 'Pos' },
      path: [{ kind: 'field', name: 'v' }, { kind: 'index', index: 0 }],
      pathKey: 'v/[0]',
      before: 1,
      after: 9,
      label: 'Set Pos',
    };
    applyEdit(command, target);
    expect(target.world.getComponent(entity, Pos)!.v[0]).toBe(9);
    revertEdit(command, target);
    expect(target.world.getComponent(entity, Pos)!.v[0]).toBe(1);
  });

  it('is a silent no-op on a despawned entity', () => {
    const { target, entity } = setup();
    target.world.despawn(entity);
    const command: SetFieldCommand = {
      kind: 'setField',
      scope: { kind: 'entity', entity, componentName: 'Pos' },
      path: [{ kind: 'field', name: 'v' }, { kind: 'index', index: 0 }],
      pathKey: 'v/[0]',
      before: 1,
      after: 9,
      label: 'Set Pos',
    };
    expect(() => applyEdit(command, target)).not.toThrow();
  });
});

describe('applyEdit / revertEdit — addComponent', () => {
  it('inserts on apply and removes on revert, without aliasing the record', () => {
    const { target, entity } = setup();
    const tag = new Tag();
    tag.name = 'hero';
    const command: AddComponentCommand = {
      kind: 'addComponent',
      entity,
      componentName: 'Tag',
      after: tag,
      label: 'Add Tag',
    };
    applyEdit(command, target);
    const stored = target.world.getComponent(entity, Tag)!;
    expect(stored.name).toBe('hero');
    expect(stored).not.toBe(tag);
    revertEdit(command, target);
    expect(target.world.has(entity, Tag)).toBe(false);
  });
});

describe('applyEdit / revertEdit — addBundle', () => {
  it('inserts every component on apply and removes them all on revert', () => {
    const { target, entity } = setup();
    const tag = new Tag();
    tag.name = 'enemy';
    const pos = new Pos();
    pos.v = new Float32Array([7, 8, 9]);
    const command: AddBundleCommand = {
      kind: 'addBundle',
      entity,
      bundleName: 'Enemy',
      label: 'Add Enemy',
      components: [
        { name: 'Tag', instance: tag },
        { name: 'Pos', instance: pos },
      ],
    };
    applyEdit(command, target);
    expect(target.world.getComponent(entity, Tag)!.name).toBe('enemy');
    expect(target.world.getComponent(entity, Pos)!.v[0]).toBe(7);
    // Inserted instances are snapshots, never the records.
    expect(target.world.getComponent(entity, Tag)).not.toBe(tag);

    revertEdit(command, target);
    expect(target.world.has(entity, Tag)).toBe(false);
    // Pos was on the entity before the bundle and is removed by the revert too,
    // matching addComponent's revert (it does not distinguish prior presence).
    expect(target.world.has(entity, Pos)).toBe(false);
  });

  it('skips components whose type is not registered', () => {
    const { target, entity } = setup();
    const command: AddBundleCommand = {
      kind: 'addBundle',
      entity,
      bundleName: 'Partial',
      label: 'Add Partial',
      components: [
        { name: 'Tag', instance: new Tag() },
        { name: 'Unregistered', instance: {} },
      ],
    };
    expect(() => applyEdit(command, target)).not.toThrow();
    expect(target.world.has(entity, Tag)).toBe(true);
  });
});
