import { describe, expect, it } from 'bun:test';

import { mat4 } from '@retro-engine/math';

import {
  buildOrthographicMatrix,
  buildPerspectiveMatrix,
  OrthographicProjection,
  PerspectiveProjection,
  ScalingMode,
  updateOrthographicArea,
} from './projection';

describe('PerspectiveProjection', () => {
  it('default-constructs with fov=π/4, near=0.1, far=1000, aspectRatio=1', () => {
    const p = new PerspectiveProjection();
    expect(p.fov).toBeCloseTo(Math.PI / 4);
    expect(p.near).toBe(0.1);
    expect(p.far).toBe(1000);
    expect(p.aspectRatio).toBe(1);
  });

  it('accepts partial overrides', () => {
    const p = new PerspectiveProjection({ fov: Math.PI / 3, far: 500 });
    expect(p.fov).toBeCloseTo(Math.PI / 3);
    expect(p.far).toBe(500);
    // Untouched fields keep defaults.
    expect(p.near).toBe(0.1);
  });
});

describe('OrthographicProjection', () => {
  it('default-constructs with sensible 3D-ish defaults', () => {
    const p = new OrthographicProjection();
    expect(p.near).toBe(0);
    expect(p.far).toBe(1000);
    expect(p.scale).toBe(1);
    expect(p.viewportOrigin).toEqual({ x: 0.5, y: 0.5 });
    expect(p.scalingMode).toBe(ScalingMode.WindowSize);
  });
});

describe('updateOrthographicArea', () => {
  it('WindowSize → area equals target dimensions', () => {
    const p = new OrthographicProjection();
    updateOrthographicArea(p, 800, 600);
    expect(p.area.maxX - p.area.minX).toBe(800);
    expect(p.area.maxY - p.area.minY).toBe(600);
    // Default viewportOrigin = (0.5, 0.5) → centered.
    expect(p.area.minX).toBe(-400);
    expect(p.area.minY).toBe(-300);
  });

  it('Fixed → area equals scaling-mode dimensions regardless of target', () => {
    const p = new OrthographicProjection({ scalingMode: ScalingMode.fixed(100, 50) });
    updateOrthographicArea(p, 800, 600);
    expect(p.area.maxX - p.area.minX).toBe(100);
    expect(p.area.maxY - p.area.minY).toBe(50);
  });

  it('FixedVertical → vertical extent fixed, horizontal follows target aspect', () => {
    const p = new OrthographicProjection({ scalingMode: ScalingMode.fixedVertical(100) });
    updateOrthographicArea(p, 800, 400);
    expect(p.area.maxY - p.area.minY).toBe(100);
    expect(p.area.maxX - p.area.minX).toBe(200); // aspect 2:1
  });

  it('FixedHorizontal → horizontal extent fixed, vertical follows target aspect', () => {
    const p = new OrthographicProjection({ scalingMode: ScalingMode.fixedHorizontal(200) });
    updateOrthographicArea(p, 800, 400);
    expect(p.area.maxX - p.area.minX).toBe(200);
    expect(p.area.maxY - p.area.minY).toBe(100); // aspect 2:1
  });

  it('AutoMin → keeps target aspect, ensures at least min dimensions visible', () => {
    const p = new OrthographicProjection({ scalingMode: ScalingMode.autoMin(100, 100) });
    // 200x100 target — wider than tall. Min ratio = min(2, 1) = 1.
    // Area = 200/1 × 100/1 = 200×100.
    updateOrthographicArea(p, 200, 100);
    expect(p.area.maxX - p.area.minX).toBe(200);
    expect(p.area.maxY - p.area.minY).toBe(100);
  });

  it('applies `scale` uniformly', () => {
    const p = new OrthographicProjection({ scale: 2 });
    updateOrthographicArea(p, 100, 100);
    expect(p.area.maxX - p.area.minX).toBe(200);
    expect(p.area.maxY - p.area.minY).toBe(200);
  });

  it('respects non-centered viewportOrigin', () => {
    const p = new OrthographicProjection({ viewportOrigin: { x: 0, y: 0 } });
    updateOrthographicArea(p, 100, 100);
    expect(p.area.minX).toBeCloseTo(0);
    expect(p.area.minY).toBeCloseTo(0);
    expect(p.area.maxX).toBeCloseTo(100);
    expect(p.area.maxY).toBeCloseTo(100);
  });
});

describe('buildPerspectiveMatrix', () => {
  it('produces the same matrix as wgpu-matrix mat4.perspective with the projection params', () => {
    const p = new PerspectiveProjection({ fov: Math.PI / 3, near: 0.5, far: 200, aspectRatio: 16 / 9 });
    const out = mat4.identity();
    buildPerspectiveMatrix(out, p);
    const ref = mat4.perspective(Math.PI / 3, 16 / 9, 0.5, 200);
    for (let i = 0; i < 16; i += 1) expect(out[i]).toBeCloseTo(ref[i]!);
  });
});

describe('buildOrthographicMatrix', () => {
  it('produces a matrix that maps the area corners to NDC ±1 in x/y', () => {
    const p = new OrthographicProjection({ near: -1, far: 1 });
    updateOrthographicArea(p, 200, 100);
    const m = mat4.identity();
    buildOrthographicMatrix(m, p);
    // Manual projection of the rect corners — column-major: y = M * x where
    // M is laid out as out[col*4 + row]. For the bottom-left corner
    // (minX, minY, 0, 1) the clip x should be -1, clip y should be -1.
    const project = (x: number, y: number, z: number): [number, number, number, number] => [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
      m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
    ];
    const bl = project(p.area.minX, p.area.minY, 0);
    const tr = project(p.area.maxX, p.area.maxY, 0);
    expect(bl[0]).toBeCloseTo(-1);
    expect(bl[1]).toBeCloseTo(-1);
    expect(tr[0]).toBeCloseTo(1);
    expect(tr[1]).toBeCloseTo(1);
  });
});
