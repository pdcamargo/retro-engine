import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { World } from '@retro-engine/ecs';
import { t, TypeRegistry } from '@retro-engine/reflect';

import { captureSnapshot, restoreSnapshot } from './play-snapshot';

class Position {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}
/** Stands in for the studio's `EditorOnly` marker — infra to leave untouched. */
class EditorTag {}

const setup = () => {
  const world = new World();
  const registry = new TypeRegistry();
  registry.registerComponent(
    Position,
    { x: t.number, y: t.number },
    { name: 'Position', make: () => new Position() },
  );
  const keep = (e: Entity) => !world.has(e, EditorTag);
  return { world, registry, keep };
};

const authoredPositions = (world: World, keep: (e: Entity) => boolean): [number, number][] =>
  [...world.entities()]
    .filter(keep)
    .map((e) => {
      const p = world.getComponent(e, Position)!;
      return [p.x, p.y] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);

describe('play-mode snapshot / restore', () => {
  it('captures only authored entities, excluding editor infra', () => {
    const { world, registry, keep } = setup();
    world.spawn(new Position(1, 2));
    world.spawn(new Position(3, 4));
    world.spawn(new EditorTag(), new Position(99, 99));

    const snapshot = captureSnapshot(world, registry, keep);
    expect(snapshot.entities).toHaveLength(2); // editor-tagged entity excluded
  });

  it('reverts play-time edits, spawns, and despawns on restore', () => {
    const { world, registry, keep } = setup();
    const a = world.spawn(new Position(1, 2));
    world.spawn(new Position(3, 4));
    world.spawn(new EditorTag(), new Position(99, 99));

    const snapshot = captureSnapshot(world, registry, keep);

    // Simulate a play session mutating the world.
    world.getComponent(a, Position)!.x = 1000;
    world.spawn(new Position(7, 8)); // play-time spawn
    world.despawn(a); // play-time despawn

    const idMap = restoreSnapshot(world, registry, snapshot, keep);

    // Authored content is back exactly; the play-time spawn is gone.
    expect(authoredPositions(world, keep)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(idMap.size).toBe(2); // fresh ids for the two restored entities
  });

  it('leaves editor-infra entities untouched across the round-trip', () => {
    const { world, registry, keep } = setup();
    world.spawn(new Position(1, 2));
    const editor = world.spawn(new EditorTag(), new Position(99, 99));

    const snapshot = captureSnapshot(world, registry, keep);
    world.spawn(new Position(5, 5));
    restoreSnapshot(world, registry, snapshot, keep);

    // Same editor entity id, same data — never despawned nor respawned.
    const editors = [...world.entities()].filter((e) => world.has(e, EditorTag));
    expect(editors).toEqual([editor]);
    expect(world.getComponent(editor, Position)!.x).toBe(99);
  });

  it('is idempotent across repeated capture/restore cycles', () => {
    const { world, registry, keep } = setup();
    world.spawn(new Position(1, 2));

    for (let i = 0; i < 3; i++) {
      const snapshot = captureSnapshot(world, registry, keep);
      world.spawn(new Position(50 + i, 0)); // transient play spawn
      restoreSnapshot(world, registry, snapshot, keep);
      expect(authoredPositions(world, keep)).toEqual([[1, 2]]);
    }
  });
});
