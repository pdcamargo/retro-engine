// Visual verification harness for Phase 6 primitives.
//
// All 15 mesh primitives (Cuboid, Sphere [ico+uv], Cylinder, Capsule3d, Torus,
// Plane3d, Cone, Tetrahedron, ConicalFrustum, Rectangle, Circle, Annulus,
// RegularPolygon, Triangle, Ellipse) ride the full Phase 6 pipeline end-to-
// end: each goes into the Meshes registry, the MeshPlugin extract+prepare
// systems pack it into a MeshAllocator slab, and a custom render-graph node
// reads the allocator slices at draw time. Catches regressions across the
// whole stack — Mesh value class, RenderMesh shape, slab packing, draw
// dispatch, HAL vertex/index binding, depth-stencil + back-face culling.

import { mat4, quat, vec3 } from '@retro-engine/math';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  PipelineLayout,
  RenderPipeline,
  ShaderModule,
  Texture,
  TextureFormat,
  TextureView,
  VertexBufferLayout,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage, TextureUsage } from '@retro-engine/renderer-core';
import type { App, Plugin } from '@retro-engine/engine';
import {
  Annulus,
  Camera3d,
  Capsule3d,
  Circle,
  Commands,
  Cone,
  ConicalFrustum,
  Cuboid,
  Cylinder,
  Ellipse,
  Mesh,
  MeshAllocator,
  MeshAttribute,
  Meshes,
  PipelineCache,
  Plane3d,
  Rectangle,
  RegularPolygon,
  RenderGraph,
  RenderMeshes,
  RenderSet,
  RenderSubGraph,
  ResMut,
  Shader,
  Sphere,
  Tetrahedron,
  Torus,
  Transform,
  Triangle,
  ViewBindGroupCache,
  createLabel,
  interMeshVertexBufferLayout,
  type CameraView,
  type Meshable,
  type MeshHandle,
  type RenderLabel,
  type RenderNodeRunContext,
  type ViewNode,
} from '@retro-engine/engine';

const SHOWCASE_WGSL = /* wgsl */ `
#import retro_engine::view

struct Model {
  matrix: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,
  color: vec4<f32>,
};

@group(1) @binding(0) var<uniform> model: Model;

struct VsOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
) -> VsOut {
  var out: VsOut;
  let worldPosition = model.matrix * vec4<f32>(position, 1.0);
  out.clipPosition = view.view_proj * worldPosition;
  out.worldNormal = normalize((model.normalMatrix * vec4<f32>(normal, 0.0)).xyz);
  out.uv = uv;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // Two-direction Lambert + ambient. The fill light keeps shadowed faces
  // legible without depth ambiguity.
  let key = normalize(vec3<f32>(0.5, 1.0, 0.3));
  let fill = normalize(vec3<f32>(-0.4, 0.2, -0.6));
  let n = normalize(in.worldNormal);
  let keyAmount = max(dot(n, key), 0.0) * 0.8;
  let fillAmount = max(dot(n, fill), 0.0) * 0.25;
  let ambient = 0.18;
  let lit = model.color.rgb * (ambient + keyAmount + fillAmount);
  return vec4<f32>(lit, 1.0);
}
`;

const DEPTH_FORMAT: TextureFormat = 'depth32float';

const ShowcaseSubGraphLabel: RenderLabel = createLabel('playground::showcase');
const ShowcaseNodeLabel: RenderLabel = createLabel('playground::showcase_pass');

interface ShowcaseEntry {
  readonly handle: MeshHandle;
  readonly label: string;
  /** World position. */
  readonly position: readonly [number, number, number];
  /** Color tint (RGB, alpha implicit 1). */
  readonly color: readonly [number, number, number];
  /** Whether the shape spins to show off its 3D-ness each frame. */
  readonly rotates: boolean;
}

interface ShowcasePipelineCache {
  readonly format: TextureFormat;
  readonly pipeline: RenderPipeline;
}

interface ShowcaseState {
  readonly entries: ShowcaseEntry[];
  readonly perEntry: Map<MeshHandle, { buffer: Buffer; bindGroup: BindGroup; scratch: Float32Array }>;
  shader?: ShaderModule;
  modelBindGroupLayout?: BindGroupLayout;
  vertexLayout?: VertexBufferLayout;
  /** Built lazily when the camera plugin's view layout exists. */
  pipelineLayout?: PipelineLayout;
  pipeline?: ShowcasePipelineCache;
  depthTexture?: Texture;
  depthView?: TextureView;
  depthWidth: number;
  depthHeight: number;
  startMs: number;
}

const layoutKey = interMeshVertexBufferLayout([
  MeshAttribute.POSITION,
  MeshAttribute.NORMAL,
  MeshAttribute.UV_0,
]);

const placePrimitives = (): { meshable: Meshable; entry: Omit<ShowcaseEntry, 'handle'> }[] => {
  // 16 cells in a 4 wide × 4 deep grid; column spacing 1.8, row spacing 2.0.
  const cell = (col: number, row: number): [number, number, number] => [
    (col - 1.5) * 1.8,
    0,
    (row - 1.5) * 2.0,
  ];
  return [
    { meshable: new Cuboid(), entry: { label: 'Cuboid', position: cell(0, 0), color: [0.95, 0.55, 0.45], rotates: true } },
    { meshable: new Sphere(), entry: { label: 'Sphere (ico)', position: cell(1, 0), color: [0.55, 0.85, 0.6], rotates: false } },
    { meshable: new Sphere(), entry: { label: 'Sphere (uv)', position: cell(2, 0), color: [0.45, 0.7, 0.95], rotates: false } },
    { meshable: new Cylinder(), entry: { label: 'Cylinder', position: cell(3, 0), color: [0.95, 0.85, 0.4], rotates: true } },
    { meshable: new Capsule3d({ radius: 0.3, halfLength: 0.4 }), entry: { label: 'Capsule3d', position: cell(0, 1), color: [0.85, 0.45, 0.85], rotates: true } },
    { meshable: new Torus({ majorRadius: 0.55, minorRadius: 0.18 }), entry: { label: 'Torus', position: cell(1, 1), color: [0.45, 0.95, 0.9], rotates: true } },
    { meshable: new Plane3d({ halfSize: [0.6, 0.6] }), entry: { label: 'Plane3d', position: cell(2, 1), color: [0.6, 0.6, 0.95], rotates: false } },
    { meshable: new Cone(), entry: { label: 'Cone', position: cell(3, 1), color: [0.95, 0.7, 0.35], rotates: true } },
    { meshable: new Tetrahedron({ circumradius: 0.6 }), entry: { label: 'Tetrahedron', position: cell(0, 2), color: [0.5, 0.95, 0.5], rotates: true } },
    { meshable: new ConicalFrustum({ radiusTop: 0.25, radiusBottom: 0.5, height: 1 }), entry: { label: 'ConicalFrustum', position: cell(1, 2), color: [0.95, 0.5, 0.55], rotates: true } },
    { meshable: new Rectangle({ halfSize: [0.55, 0.4] }), entry: { label: 'Rectangle', position: cell(2, 2), color: [0.8, 0.4, 0.4], rotates: false } },
    { meshable: new Circle({ radius: 0.45 }), entry: { label: 'Circle', position: cell(3, 2), color: [0.4, 0.8, 0.4], rotates: false } },
    { meshable: new Annulus({ innerRadius: 0.22, outerRadius: 0.45 }), entry: { label: 'Annulus', position: cell(0, 3), color: [0.4, 0.6, 0.95], rotates: false } },
    { meshable: new RegularPolygon({ circumradius: 0.45, sides: 5 }), entry: { label: 'RegularPolygon', position: cell(1, 3), color: [0.95, 0.85, 0.5], rotates: false } },
    { meshable: new Triangle({ a: [-0.5, -0.4], b: [0.5, -0.4], c: [0, 0.5] }), entry: { label: 'Triangle', position: cell(2, 3), color: [0.85, 0.55, 0.9], rotates: false } },
    { meshable: new Ellipse({ halfWidth: 0.55, halfHeight: 0.3 }), entry: { label: 'Ellipse', position: cell(3, 3), color: [0.5, 0.95, 0.85], rotates: false } },
  ];
};

const MODEL_UNIFORM_BYTES = 144; // mat4(64) + mat4(64) + vec4(16); aligned to 16.

/**
 * Ensure the showcase pipeline is built. Deferred from startup because the
 * camera plugin allocates its `@group(0)` view bind group layout lazily on
 * first extract — at startup the layout is `undefined`. The pipeline can be
 * built once the layout exists (first frame's `RenderSet.Prepare` runs).
 */
const ensurePipeline = (app: App, state: ShowcaseState, targetFormat: TextureFormat): void => {
  if (state.pipeline && state.pipeline.format === targetFormat) return;
  const viewCache = app.getResource(ViewBindGroupCache);
  if (!viewCache?.layout) return;
  if (!state.shader || !state.modelBindGroupLayout || !state.vertexLayout) return;
  if (!state.pipelineLayout) {
    state.pipelineLayout = app.renderer.createPipelineLayout({
      label: 'showcase',
      bindGroupLayouts: [viewCache.layout, state.modelBindGroupLayout],
    });
  }
  state.pipeline = {
    format: targetFormat,
    pipeline: app.renderer.createRenderPipeline({
      label: 'primitives-showcase',
      layout: state.pipelineLayout,
      vertex: {
        module: state.shader,
        entryPoint: 'vs_main',
        buffers: [state.vertexLayout],
      },
      fragment: {
        module: state.shader,
        entryPoint: 'fs_main',
        targets: [{ format: targetFormat }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    }),
  };
};

/**
 * Custom view-node that opens a color + depth pass for the showcase camera
 * and draws every primitive once.
 */
const buildShowcaseNode = (state: ShowcaseState): ViewNode => {
  const tmpMatrix = mat4.identity();
  const tmpRotation = quat.identity();
  return {
    label: ShowcaseNodeLabel,
    __viewNode: true as const,
    input: () => [],
    output: () => [],
    run(ctx: RenderNodeRunContext): void {
      const view = ctx.view;
      const encoder = ctx.encoder;
      if (view === undefined || encoder === undefined) return;
      const app = ctx.app;
      ensurePipeline(app, state, view.target.format);
      ensureDepthTexture(app, state, view);
      if (!state.pipeline || !state.depthView) return;
      const renderMeshes = app.getResource(RenderMeshes);
      const allocator = app.getResource(MeshAllocator);
      if (!renderMeshes || !allocator) return;

      const pass = encoder.beginRenderPass({
        label: `showcase#${view.sourceEntity}`,
        colorAttachments: [
          {
            view: view.target.view,
            loadOp: view.loadOp,
            storeOp: 'store',
            ...(view.clearColor !== undefined ? { clearValue: view.clearColor } : {}),
          },
        ],
        depthStencilAttachment: {
          view: state.depthView,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1,
        },
      });
      pass.setPipeline(state.pipeline.pipeline);
      pass.setBindGroup(0, view.viewBindGroup);

      const elapsedMs = performance.now() - state.startMs;
      const elapsedSec = elapsedMs * 0.001;
      for (const entry of state.entries) {
        const per = state.perEntry.get(entry.handle);
        if (!per) continue;
        const rm = renderMeshes.get(entry.handle);
        if (!rm) continue;
        const vSlice = allocator.vertexSlice(entry.handle);
        if (!vSlice) continue;

        // Translation + optional Y-axis spin.
        const angle = entry.rotates ? elapsedSec * 0.7 : 0;
        quat.fromAxisAngle(vec3.create(0, 1, 0), angle, tmpRotation);
        mat4.fromQuat(tmpRotation, tmpMatrix);
        tmpMatrix[12] = entry.position[0];
        tmpMatrix[13] = entry.position[1];
        tmpMatrix[14] = entry.position[2];

        // Pack uniform: [model 64 B][normalMatrix 64 B][color 16 B].
        // No non-uniform scale today → normal matrix equals the model matrix.
        per.scratch.set(tmpMatrix as Float32Array, 0);
        per.scratch.set(tmpMatrix as Float32Array, 16);
        per.scratch[32] = entry.color[0];
        per.scratch[33] = entry.color[1];
        per.scratch[34] = entry.color[2];
        per.scratch[35] = 1;
        app.renderer.writeBuffer(per.buffer, 0, per.scratch as BufferSource);
        pass.setBindGroup(1, per.bindGroup);

        // Bind the whole slab at offset 0 and pick the per-mesh slot via
        // `baseVertex` / `firstIndex` — the slab-allocator pattern the
        // `AllocatorSlice.baseVertex` field was designed for. Passing both
        // an explicit offset AND a baseVertex would double-count and read
        // from the wrong region of the slab.
        pass.setVertexBuffer(0, vSlice.buffer);
        if (rm.bufferInfo.kind === 'indexed') {
          const iSlice = allocator.indexSlice(entry.handle);
          if (!iSlice) continue;
          pass.setIndexBuffer(iSlice.buffer, rm.bufferInfo.indexFormat);
          pass.drawIndexed(
            rm.bufferInfo.indexCount,
            1,
            iSlice.baseVertex,
            vSlice.baseVertex,
            0,
          );
        } else {
          pass.draw(rm.vertexCount, 1, vSlice.baseVertex, 0);
        }
      }
      pass.end();
    },
  };
};

const ensureDepthTexture = (app: App, state: ShowcaseState, view: CameraView): void => {
  const targetW = view.target.width;
  const targetH = view.target.height;
  if (state.depthTexture && state.depthWidth === targetW && state.depthHeight === targetH) {
    return;
  }
  if (state.depthTexture) state.depthTexture.destroy();
  state.depthTexture = app.renderer.createTexture({
    label: 'showcase-depth',
    width: targetW,
    height: targetH,
    format: DEPTH_FORMAT,
    usage: TextureUsage.RENDER_ATTACHMENT,
  });
  state.depthView = state.depthTexture.createView();
  state.depthWidth = targetW;
  state.depthHeight = targetH;
};

/**
 * Showcase plugin. Adds all 15 primitives to the Meshes registry, registers
 * the custom render sub-graph + draw node, and wires per-mesh model bind
 * groups on `RenderSet.Prepare`. Camera spawns at startup pointing at the
 * grid.
 */
export const primitivesShowcasePlugin: Plugin = (app) => {
  const log = app.logger.child('showcase');
  const placements = placePrimitives();
  const state: ShowcaseState = {
    entries: [],
    perEntry: new Map(),
    depthWidth: 0,
    depthHeight: 0,
    startMs: performance.now(),
  };

  // Custom sub-graph: one node owning the entire color + depth pass for this
  // camera. Replaces the engine's default Core3d sub-graph for the showcase
  // camera so the showcase owns its own depth attachment.
  const subGraph = new RenderSubGraph(ShowcaseSubGraphLabel);
  subGraph.addNode(buildShowcaseNode(state));
  const graph = app.getResource(RenderGraph);
  if (!graph) {
    throw new Error('primitivesShowcasePlugin: RenderGraph resource missing — CorePlugin not yet built');
  }
  graph.addSubGraph(subGraph);

  app.addSystem('startup', [Commands, ResMut(Meshes), ResMut(PipelineCache)], (cmd, meshes, pipelineCache) => {
    const { renderer } = app;

    for (const { meshable, entry } of placements) {
      const mesh: Mesh = meshable.mesh().build();
      const handle = meshes.add(mesh);
      state.entries.push({ handle, ...entry });
    }

    const shader = new Shader(SHOWCASE_WGSL, { label: 'primitives-showcase' });
    state.shader = pipelineCache.compileShader(shader);
    state.modelBindGroupLayout = renderer.createBindGroupLayout({
      label: 'showcase-model',
      entries: [
        { binding: 0, visibility: ShaderStage.VERTEX | ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    state.vertexLayout = layoutKey.layout;

    // Camera at (0, 4, 7) tilted to look at the origin.
    const camTransform = new Transform();
    camTransform.translation = vec3.create(0, 4, 7);
    quat.fromAxisAngle(vec3.create(1, 0, 0), -Math.PI / 6, camTransform.rotation);
    cmd.spawn(...Camera3d({ transform: camTransform, subGraph: ShowcaseSubGraphLabel }));

    log.info(`spawned ${state.entries.length} primitives across the showcase grid`);
  });

  // Lazily build per-mesh model bind groups in `RenderSet.Prepare`, after
  // MeshPlugin has uploaded the meshes to the allocator (i.e. when
  // `RenderMeshes.has(handle)` is true).
  app.addSystem(
    'render',
    [ResMut(RenderMeshes)],
    (renderMeshes) => {
      if (!state.modelBindGroupLayout) return;
      for (const entry of state.entries) {
        if (state.perEntry.has(entry.handle)) continue;
        if (!renderMeshes.has(entry.handle)) continue;
        const buffer = app.renderer.createBuffer({
          size: MODEL_UNIFORM_BYTES,
          usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
          label: `showcase-model#${entry.label}`,
        });
        const bindGroup = app.renderer.createBindGroup({
          label: `showcase-model#${entry.label}`,
          layout: state.modelBindGroupLayout,
          entries: [{ binding: 0, resource: { buffer } }],
        });
        state.perEntry.set(entry.handle, {
          buffer,
          bindGroup,
          scratch: new Float32Array(MODEL_UNIFORM_BYTES / 4),
        });
      }
    },
    { set: RenderSet.Prepare },
  );
};
