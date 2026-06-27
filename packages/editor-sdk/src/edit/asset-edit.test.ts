import { describe, expect, it } from 'bun:test';
import { World } from '@retro-engine/ecs';
import { TypeRegistry } from '@retro-engine/reflect';

import { applyEdit, type AssetEditAccess, type EditTarget, revertEdit } from './apply';
import type { SetFieldCommand } from './command';
import { createAssetHistoryEmitter } from './emitter-history';
import { History } from './history';

/** A stub asset store: one material-like value, addressed by (kind, guid). */
const makeTarget = (): { target: EditTarget; value: { roughness: number }; dirty: string[] } => {
  const value = { roughness: 0.5 };
  const dirty: string[] = [];
  const assets: AssetEditAccess = {
    getMut: (kind, guid) => (kind === 'StandardMaterial' && guid === 'mat-1' ? value : undefined),
    markDirty: (kind, guid) => dirty.push(`${kind}#${guid}`),
  };
  return { target: { world: new World(), registry: new TypeRegistry(), assets }, value, dirty };
};

const assetCommand = (before: number, after: number): SetFieldCommand => ({
  kind: 'setField',
  scope: { kind: 'asset', assetKind: 'StandardMaterial', guid: 'mat-1' },
  path: [{ kind: 'field', name: 'roughness' }],
  pathKey: 'roughness',
  before,
  after,
  label: 'Set StandardMaterial',
});

describe('applyEdit / revertEdit — asset setField', () => {
  it('writes through the asset port and marks dirty; revert restores', () => {
    const { target, value, dirty } = makeTarget();
    const command = assetCommand(0.5, 0.2);

    applyEdit(command, target);
    expect(value.roughness).toBeCloseTo(0.2, 6);
    expect(dirty).toEqual(['StandardMaterial#mat-1']);

    revertEdit(command, target);
    expect(value.roughness).toBeCloseTo(0.5, 6);
  });

  it('is a silent no-op when no asset access is wired', () => {
    const target: EditTarget = { world: new World(), registry: new TypeRegistry() };
    expect(() => applyEdit(assetCommand(0.5, 0.2), target)).not.toThrow();
  });
});

describe('History — asset edits are undoable', () => {
  it('commitScoped on an asset records an undoable entry', () => {
    const { target, value } = makeTarget();
    const history = new History(target);
    const scope = { kind: 'asset', assetKind: 'StandardMaterial', guid: 'mat-1' } as const;

    history.commitScoped(scope, [{ kind: 'field', name: 'roughness' }], 0.5, 0.9);
    expect(value.roughness).toBeCloseTo(0.9, 6);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(value.roughness).toBeCloseTo(0.5, 6);

    history.redo();
    expect(value.roughness).toBeCloseTo(0.9, 6);

    // The timeline view carries the asset scope (no entity).
    const entry = history.view().entries.at(-1)!;
    expect(entry.kind).toBe('setField');
    expect(entry.scope).toEqual(scope);
    expect(entry.entity).toBeUndefined();
  });

  it('createAssetHistoryEmitter routes commits through the history', () => {
    const { target, value } = makeTarget();
    const history = new History(target);
    const emitter = createAssetHistoryEmitter(history, 'StandardMaterial', 'mat-1');

    emitter.scalar([{ kind: 'field', name: 'roughness' }], 0.5).commit(0.3);
    expect(value.roughness).toBeCloseTo(0.3, 6);
    history.undo();
    expect(value.roughness).toBeCloseTo(0.5, 6);
  });
});
