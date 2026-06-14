import { describe, expect, it } from 'bun:test';
import { mat4, quat, vec3 } from '@retro-engine/math';

import { worldToScreen } from './hit-test';
import { TransformGizmo } from './transform-gizmo';
import type { GizmoInput, GizmosLike, GizmoPointer, GizmoTarget } from './types';

const noopGizmos: GizmosLike = {
  line: () => {},
  arrow: () => {},
  circle: () => {},
  cuboid: () => {},
};

const viewProj = mat4.multiply(
  mat4.perspective(Math.PI / 4, 800 / 600, 0.1, 100),
  mat4.lookAt(vec3.create(3, 3, 3), vec3.create(0, 0, 0), vec3.create(0, 1, 0)),
);
const camera = {
  viewProjectionMatrix: viewProj,
  worldPosition: vec3.create(3, 3, 3),
  targetSize: { width: 800, height: 600 },
};
const viewport = { x: 0, y: 0, width: 800, height: 600 };

const target = (): GizmoTarget => ({
  translation: vec3.create(0, 0, 0),
  rotation: quat.identity(),
  scale: vec3.create(1, 1, 1),
});

const pointer = (over: Partial<GizmoPointer>): GizmoPointer => ({
  position: null,
  down: false,
  pressed: false,
  released: false,
  cancel: false,
  ...over,
});

const baseInput = (tgt: GizmoTarget, pointerState: GizmoPointer): GizmoInput => ({
  camera,
  viewport,
  pointer: pointerState,
  mode: 'move',
  space: '3d',
  targets: [tgt],
});

describe('TransformGizmo', () => {
  it('is idle with no pointer over the gizmo', () => {
    const g = new TransformGizmo(noopGizmos);
    const state = g.update(baseInput(target(), pointer({ position: [10, 10] })));
    expect(state.phase).toBe('idle');
  });

  it('hovers the X-axis handle when the cursor is on it', () => {
    const g = new TransformGizmo(noopGizmos);
    // Project a point a little way along +X (within the axis handle) to screen.
    const onAxis = worldToScreen(vec3.create(0.6, 0, 0), viewProj, viewport)!;
    const state = g.update(baseInput(target(), pointer({ position: [onAxis[0], onAxis[1]] })));
    expect(state.phase).toBe('hover');
    expect(state.phase === 'hover' && state.handle.kind).toBe('move-axis');
    expect(state.phase === 'hover' && state.handle.kind === 'move-axis' && state.handle.axis).toBe(0);
  });

  it('drags the target along +X and reverts on cancel', () => {
    const g = new TransformGizmo(noopGizmos);
    const tgt = target();
    const start = worldToScreen(vec3.create(0.6, 0, 0), viewProj, viewport)!;
    const end = worldToScreen(vec3.create(1.4, 0, 0), viewProj, viewport)!;

    // Press on the handle.
    g.update(baseInput(tgt, pointer({ position: [start[0], start[1]], down: true, pressed: true })));
    expect(g.state.phase).toBe('drag');

    // Drag toward the tip → target advances along +X, off-axis stays ~0.
    g.update(baseInput(tgt, pointer({ position: [end[0], end[1]], down: true })));
    expect(tgt.translation[0]).toBeGreaterThan(0.05);
    expect(Math.abs(tgt.translation[1]!)).toBeLessThan(1e-3);
    expect(Math.abs(tgt.translation[2]!)).toBeLessThan(1e-3);

    // Escape mid-drag reverts to the pre-drag transform.
    g.update(baseInput(tgt, pointer({ position: [end[0], end[1]], down: true, cancel: true })));
    expect(tgt.translation[0]).toBeCloseTo(0, 5);

    // Release ends the interaction.
    const released = g.update(baseInput(tgt, pointer({ position: [end[0], end[1]], released: true })));
    expect(released.phase).toBe('idle');
  });

  it('reports idle and clears any drag when targets are empty', () => {
    const g = new TransformGizmo(noopGizmos);
    const state = g.update({ ...baseInput(target(), pointer({ position: [10, 10] })), targets: [] });
    expect(state.phase).toBe('idle');
  });
});
