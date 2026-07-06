import { describe, expect, it } from 'bun:test';

import { t } from '@retro-engine/reflect';
import type { DecodeEnv, EncodeEnv } from '@retro-engine/reflect';
import { decodeComponent, encodeComponent, TypeRegistry } from '@retro-engine/reflect';
import type { RegisteredType } from '@retro-engine/reflect';

import { ActionBinding, ActionDef, ActionMap, key, mouseButton } from './action-types';

// The schema InputPlugin.build registers, exercised directly against a fresh
// registry so the serialization round-trip is verified without an App.
const makeRegistry = (): { reg: TypeRegistry; entry: RegisteredType<ActionMap> } => {
  const reg = new TypeRegistry();
  reg.registerType(
    ActionBinding,
    {
      role: t.enum('trigger', 'positiveX', 'negativeX', 'positiveY', 'negativeY'),
      device: t.enum('key', 'mouse'),
      code: t.string,
    },
    { name: 'ActionBinding', make: () => new ActionBinding() },
  );
  reg.registerType(
    ActionDef,
    {
      name: t.string,
      kind: t.enum('button', 'axis', 'axis2d'),
      bindings: t.array(t.type(ActionBinding)),
    },
    { name: 'ActionDef', make: () => new ActionDef() },
  );
  const entry = reg.registerComponent(
    ActionMap,
    { defs: t.array(t.type(ActionDef)) },
    { name: 'ActionMap' },
  );
  return { reg, entry };
};

const encEnv = (registry: TypeRegistry): EncodeEnv =>
  ({
    registry,
    entityId: (e) => e as unknown as number,
    handleRef: (_assetType, h) => h.guid,
  }) as EncodeEnv;

const decEnv = (registry: TypeRegistry): DecodeEnv =>
  ({
    registry,
    entity: (id: number) => id,
    resolveHandle: () => {
      throw new Error('action-reflection.test: no handles expected');
    },
  }) as unknown as DecodeEnv;

describe('ActionMap reflection round-trip', () => {
  it('serializes and restores a mixed map of button / axis / axis2d actions', () => {
    const { reg, entry } = makeRegistry();

    const map = new ActionMap()
      .button('Jump', key('Space'))
      .button('Fire', key('KeyF'), mouseButton('Left'))
      .axis('MoveX', { negative: key('KeyA'), positive: key('KeyD') })
      .axis2d('Move', { left: key('KeyA'), right: key('KeyD'), up: key('KeyW'), down: key('KeyS') });

    const serialized = encodeComponent(entry, map, encEnv(reg));
    const back = decodeComponent(entry, serialized, decEnv(reg)) as ActionMap;

    expect(back).toBeInstanceOf(ActionMap);
    expect(back.defs).toHaveLength(4);
    expect(back.get('Fire')?.bindings).toEqual([
      { role: 'trigger', device: 'key', code: 'KeyF' },
      { role: 'trigger', device: 'mouse', code: 'Left' },
    ]);
    expect(back.get('Move')?.kind).toBe('axis2d');
    expect(back.get('MoveX')?.bindings.map((b) => b.role)).toEqual(['negativeX', 'positiveX']);
    // Nested value types reconstruct as their real classes, not plain objects.
    expect(back.get('Jump')?.bindings[0]).toBeInstanceOf(ActionBinding);
    expect(back.defs[0]).toBeInstanceOf(ActionDef);
  });
});
