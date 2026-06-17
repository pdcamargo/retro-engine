import { describe, expect, it } from 'bun:test';
import { type Entity, World } from '@retro-engine/ecs';
import type { Vec3 } from '@retro-engine/math';
import { type RegisteredType, TypeRegistry, t } from '@retro-engine/reflect';

import { applyEdit, type EditTarget, revertEdit } from './apply';
import type { AddComponentCommand, SetFieldCommand } from './command';

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
      entity,
      componentName: 'Pos',
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
      entity,
      componentName: 'Pos',
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
