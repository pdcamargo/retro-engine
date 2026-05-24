// Shader system hot paths (Renderer Phase 4 / ADR-0022):
//
// - `preprocessWgsl` — runs once per `compileShader` cache miss. Regression
//   here = longer startup as more shaders accumulate.
// - `PipelineCache.compileShader` hit & miss — every render system that
//   builds a pipeline hits this; regression = colder startup or per-frame
//   stalls on first-call paths.
// - `PipelineCache.getOrCreateRenderPipeline` hit & miss — the descriptor
//   hash + cache lookup. Hit-rate is the per-frame path under
//   `SpecializedRenderPipelines`; miss is one-time per descriptor.
// - `SpecializedRenderPipelines.get` hit — the canonical per-frame hot
//   path. Runs once per active camera × pipeline family. Single most
//   important slot for a regression gate.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0022 (shader system).

import { bench, summary } from 'mitata';
import type { RenderPipelineDescriptor, TextureFormat } from '@retro-engine/renderer-core';

import {
  PipelineCache,
  preprocessWgsl,
  Shader,
  ShaderRegistry,
  SpecializedRenderPipelines,
} from '../src/shader';

import { makeShaderBenchRenderer } from './helpers';

const VIEW_WGSL = /* wgsl */ `
struct ViewUniform {
  view_proj: mat4x4<f32>,
  view: mat4x4<f32>,
  inverse_view: mat4x4<f32>,
  projection: mat4x4<f32>,
  world_position: vec4<f32>,
  viewport: vec4<f32>,
};
@group(0) @binding(0) var<uniform> view: ViewUniform;
`;

const SMALL_WGSL = /* wgsl */ `
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>( 0.5, -0.5),
  );
  return vec4<f32>(positions[vi], 0.0, 1.0);
}
@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}
`;

// A representative "real" shader: imports the view module, gates an HDR
// path on an external define, and runs ~80 lines of body.
const MEDIUM_WGSL = /* wgsl */ `
#import bench::view

struct Material {
  base_color: vec4<f32>,
  metallic: f32,
  roughness: f32,
  emissive_strength: f32,
  _pad: f32,
};

@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var albedo_tex: texture_2d<f32>;
@group(1) @binding(2) var albedo_sampler: sampler;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_position: vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let world = vec4<f32>(in.position, 1.0);
  out.clip_position = view.view_proj * world;
  out.world_position = world.xyz;
  out.world_normal = in.normal;
  out.uv = in.uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let albedo = textureSample(albedo_tex, albedo_sampler, in.uv);
  var color = albedo.rgb * material.base_color.rgb;
  #ifdef HDR
  let view_dir = normalize(view.world_position.xyz - in.world_position);
  let n_dot_v = max(dot(in.world_normal, view_dir), 0.0);
  let fresnel = pow(1.0 - n_dot_v, 5.0);
  color = color + fresnel * material.emissive_strength;
  #else
  color = color + material.base_color.rgb * material.emissive_strength * 0.5;
  #endif
  return vec4<f32>(color, material.base_color.a);
}
`;

// Synthetic large shader (~2k lines) by repeating a helper-function template.
// Captures preprocessor cost on shaders that approach the size of a real
// PBR + lighting + tonemap stack.
const buildLargeWgsl = (): string => {
  const parts: string[] = ['#import bench::view\n'];
  for (let i = 0; i < 80; i += 1) {
    parts.push(`fn helper_${i}(x: f32, y: f32) -> f32 {`);
    parts.push(`  let a = x * ${i}.0 + y;`);
    parts.push(`  let b = sin(a) * cos(y);`);
    parts.push(`  let c = b * b + a;`);
    parts.push(`  #ifdef HDR`);
    parts.push(`  let d = c * 2.0;`);
    parts.push(`  #else`);
    parts.push(`  let d = c * 0.5;`);
    parts.push(`  #endif`);
    parts.push(`  return d / max(abs(c) + 0.0001, 1.0);`);
    parts.push(`}`);
    parts.push('');
  }
  parts.push('@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }');
  parts.push('@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(0.0); }');
  return parts.join('\n');
};

const LARGE_WGSL = buildLargeWgsl();

interface Shape {
  readonly name: string;
  readonly source: string;
}

const shapes: readonly Shape[] = [
  { name: 'small', source: SMALL_WGSL },
  { name: 'medium', source: MEDIUM_WGSL },
  { name: 'large', source: LARGE_WGSL },
];

const buildRegistry = (): ShaderRegistry => {
  const r = new ShaderRegistry();
  r.register('bench::view', VIEW_WGSL);
  return r;
};

summary(() => {
  for (const shape of shapes) {
    bench(`preprocessWgsl @ ${shape.name}`, function* () {
      const registry = buildRegistry();
      const src = shape.source;
      yield () => preprocessWgsl(src, registry, { defines: { HDR: true } });
    });
  }
});

summary(() => {
  for (const shape of shapes) {
    bench(`PipelineCache.compileShader miss @ ${shape.name}`, function* () {
      // Each iteration sees a unique source via a counter prefix so the
      // shader-module cache always misses. The preprocessor + the renderer's
      // createShaderModule (inert) both run.
      const registry = buildRegistry();
      const cache = new PipelineCache(makeShaderBenchRenderer(), registry);
      const base = shape.source;
      let i = 0;
      yield () => {
        i += 1;
        cache.compileShader(new Shader(`// v${i}\n${base}`));
      };
    });

    bench(`PipelineCache.compileShader hit @ ${shape.name}`, function* () {
      const registry = buildRegistry();
      const cache = new PipelineCache(makeShaderBenchRenderer(), registry);
      const shader = new Shader(shape.source);
      cache.compileShader(shader); // prime
      yield () => cache.compileShader(shader);
    });
  }
});

summary(() => {
  bench('PipelineCache.getOrCreateRenderPipeline miss', function* () {
    const renderer = makeShaderBenchRenderer();
    const cache = new PipelineCache(renderer, buildRegistry());
    const module = cache.compileShader(new Shader(SMALL_WGSL));
    let i = 0;
    yield () => {
      i += 1;
      cache.getOrCreateRenderPipeline({
        label: `bench-${i}`,
        layout: 'auto',
        // Vary the fragment entry-point text so each descriptor is unique
        // and the cache always misses. createRenderPipeline (inert) runs.
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: `fs_main_${i}`,
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      });
    };
  });

  bench('PipelineCache.getOrCreateRenderPipeline hit', function* () {
    const renderer = makeShaderBenchRenderer();
    const cache = new PipelineCache(renderer, buildRegistry());
    const module = cache.compileShader(new Shader(SMALL_WGSL));
    const descriptor: RenderPipelineDescriptor = {
      label: 'bench',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    };
    cache.getOrCreateRenderPipeline(descriptor); // prime
    yield () => cache.getOrCreateRenderPipeline(descriptor);
  });
});

interface DemoKey {
  readonly format: TextureFormat;
}

summary(() => {
  // The canonical per-frame hot path: SpecializedRenderPipelines.get against
  // a primed cache. This is what fires once per camera × pipeline family
  // every render frame. Regression here is felt as added per-frame overhead
  // proportional to (cameras × specializers).
  bench('SpecializedRenderPipelines.get hit', function* () {
    const renderer = makeShaderBenchRenderer();
    const cache = new PipelineCache(renderer, buildRegistry());
    const module = cache.compileShader(new Shader(SMALL_WGSL));
    const specs = new SpecializedRenderPipelines<DemoKey>(cache, (key) => ({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: key.format }],
      },
      primitive: { topology: 'triangle-list' },
    }));
    const key: DemoKey = { format: 'rgba8unorm' };
    specs.get(key); // prime
    yield () => specs.get(key);
  });

  bench('SpecializedRenderPipelines.get miss-then-hit (first call)', function* () {
    // Cold-call cost: covers `specialize()` + descriptor hash + first
    // pipeline-cache miss. Bench rebuilds the specializer each iteration so
    // every call is a cold miss.
    const renderer = makeShaderBenchRenderer();
    const cache = new PipelineCache(renderer, buildRegistry());
    const module = cache.compileShader(new Shader(SMALL_WGSL));
    let i = 0;
    yield () => {
      i += 1;
      // New specializer + new key value each iteration → forced miss.
      const specs = new SpecializedRenderPipelines<DemoKey>(cache, (key) => ({
        label: `s-${i}`,
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: `fs_main_${i}`,
          targets: [{ format: key.format }],
        },
        primitive: { topology: 'triangle-list' },
      }));
      specs.get({ format: 'rgba8unorm' });
    };
  });
});
