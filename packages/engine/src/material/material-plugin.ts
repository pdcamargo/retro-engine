import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import type {
  BindGroupLayout,
  PipelineLayout,
  RenderPipelineDescriptor,
  ShaderModule,
  TextureFormat,
  VertexBufferLayout,
} from '@retro-engine/renderer-core';

import { ViewBindGroupCache } from '../camera/extracted';
import { SortedCameras } from '../camera/sorted-cameras';
import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import type { App } from '../index';
import type { AllocatorSlice, MeshHandle } from '../mesh';
import { MeshAllocator, Meshes, Mesh3d, RenderMeshes } from '../mesh';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import type { PhaseItem3d } from '../render-graph/phase-3d';
import { ViewPhases3d } from '../render-graph/phase-3d';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type { BindGroupSchema } from './bind-group-schema';
import type { Material, MaterialPipelineKey, ShaderRef } from './material';
import { alphaModeKey } from './material';
import type { MaterialHandle } from './materials';
import { Materials } from './materials';
import { MeshMaterial3d } from './mesh-material-3d';
import { INSTANCE_LAYOUT } from './instance-layout';
import { MeshInstanceBuffer } from './mesh-instance-buffer';
import type { AlphaBucket, InstanceEntry } from './instance-batching';
import { makeInstancedDraw, packInstancedBatches } from './instance-batching';
import type { PreparedMaterial } from './prepare-bind-group';
import { prepareBindGroup, schemaToBindGroupLayout } from './prepare-bind-group';
import { RenderMaterials } from './render-materials';

/**
 * Static surface every material class must provide. Validated at
 * `MaterialPlugin<M>.build()` time. Not encoded as a TS interface because
 * TypeScript does not model static-method polymorphism (a class type cannot
 * declare a `static` method as part of its instance shape).
 */
export interface MaterialCtor<M extends Material> {
  new (...args: never[]): M;
  readonly name: string;
  readonly bindGroup: BindGroupSchema<M>;
  vertexShader?(): ShaderRef;
  fragmentShader?(): ShaderRef;
  specialize?(
    descriptor: RenderPipelineDescriptor,
    vertexLayout: VertexBufferLayout,
    key: MaterialPipelineKey,
  ): void;
}

/** Optional configuration for {@link MaterialPlugin}. None for Phase 7. */
export type MaterialPluginOptions = Record<string, never>;

/**
 * Engine plugin owning one material type's data + draw pipeline.
 *
 * Construct with the material class:
 *
 * ```ts
 * const unlit = new MaterialPlugin(UnlitMaterial);
 * app.addPlugin(unlit);
 * const handle = world.getResource(unlit.Materials)!.add(new UnlitMaterial(...));
 * world.spawn(new Mesh3d(meshHandle), new unlit.MeshMaterial3d(handle));
 * ```
 *
 * On `build`, the plugin:
 *
 * - Synthesises per-material-type subclasses of {@link Materials},
 *   {@link RenderMaterials}, and {@link MeshMaterial3d} so the engine's
 *   class-keyed ECS / resource store can disambiguate `UnlitMaterial` from
 *   `StandardMaterial` at runtime despite TypeScript's erased generics.
 * - Inserts the {@link Materials} resource (main world) and
 *   {@link RenderMaterials} resource (render world).
 * - Builds the material's `BindGroupLayout` from `M.bindGroup` (ADR-0027).
 * - Resolves vertex / fragment shaders against `ShaderRegistry` via the
 *   material's `vertexShader()` / `fragmentShader()` `ShaderRef`s.
 * - Caches a {@link SpecializedRenderPipelines}`<MaterialPipelineKey>` that
 *   varies pipeline state by `(alphaMode, hdr, msaaSamples, vertexLayout)`.
 * - Registers the per-stage systems documented in ADR-0028 §5: prepare
 *   materials (consume asset events → upload uniforms / build bind groups);
 *   queue materials (iterate visible `Mesh3d` + `MeshMaterial3d<M>` entities,
 *   push phase items into {@link ViewPhases3d}).
 *
 * Not unique — instantiate one per material type. Re-instantiating for the
 * same material type throws at `build()`.
 */
export class MaterialPlugin<M extends Material> implements PluginObject {
  readonly materialClass: MaterialCtor<M>;
  /** Per-type subclass of {@link Materials} — register / look up via this constructor. */
  readonly Materials: new () => Materials<M>;
  /** Per-type subclass of {@link RenderMaterials} — render-world prepared bind groups. */
  readonly RenderMaterials: new () => RenderMaterials<M>;
  /** Per-type subclass of {@link MeshMaterial3d} — spawn `new plugin.MeshMaterial3d(handle)`. */
  readonly MeshMaterial3d: new (handle: MaterialHandle<M>) => MeshMaterial3d<M>;

  constructor(materialClass: MaterialCtor<M>, _options?: MaterialPluginOptions) {
    this.materialClass = materialClass;

    const MaterialsBase = Materials as unknown as new () => Materials<M>;
    const MaterialsSubclass = class extends MaterialsBase {};
    Object.defineProperty(MaterialsSubclass, 'name', {
      value: `Materials<${materialClass.name}>`,
    });
    this.Materials = MaterialsSubclass as unknown as new () => Materials<M>;

    const RenderMaterialsBase = RenderMaterials as unknown as new () => RenderMaterials<M>;
    const RenderMaterialsSubclass = class extends RenderMaterialsBase {};
    Object.defineProperty(RenderMaterialsSubclass, 'name', {
      value: `RenderMaterials<${materialClass.name}>`,
    });
    this.RenderMaterials = RenderMaterialsSubclass as unknown as new () => RenderMaterials<M>;

    const MeshMaterialBase = MeshMaterial3d as unknown as new (
      h: MaterialHandle<M>,
    ) => MeshMaterial3d<M>;
    const MeshMaterialSubclass = class extends MeshMaterialBase {};
    Object.defineProperty(MeshMaterialSubclass, 'name', {
      value: `MeshMaterial3d<${materialClass.name}>`,
    });
    this.MeshMaterial3d = MeshMaterialSubclass as unknown as new (
      h: MaterialHandle<M>,
    ) => MeshMaterial3d<M>;
  }

  name(): string {
    return `MaterialPlugin<${this.materialClass.name}>`;
  }

  isUnique(): boolean {
    return false;
  }

  build(app: App): void {
    if (app.getResource(this.Materials) !== undefined) {
      throw new Error(
        `${this.name()}: a Materials registry for this material type is already installed; do not add the same MaterialPlugin twice.`,
      );
    }
    app.insertResource(new this.Materials());
    app.insertResource(new this.RenderMaterials());
    if (app.getResource(ViewPhases3d) === undefined) {
      app.insertResource(new ViewPhases3d());
    }

    // GPU resource creation is deferred to the first system tick — the
    // renderer's device is undefined until `app.run()` awaits `init()`, which
    // happens AFTER every plugin's `build` runs. The prepare/queue systems
    // guard with `state.ensureInitialised(app)`.
    const state = new MaterialPluginState(this);

    const MaterialsCtor = this.Materials;
    const RenderMaterialsCtor = this.RenderMaterials;
    const MeshMaterialCtor = this.MeshMaterial3d;

    // Prepare: drain Materials<M> events; for added/modified, build or rebuild
    // the per-handle PreparedMaterial in RenderMaterials<M>; for removed,
    // destroy and drop. `after: ['image-prepare']` ensures `RenderImages` is
    // populated before the schema walker resolves any `imageMode: 'handle'`
    // binding.
    app.addSystem(
      'render',
      [ResMut(MaterialsCtor), ResMut(RenderMaterialsCtor), Res(Images), Res(RenderImages)],
      (materials, renderMaterials, images, renderImages) => {
        state.ensureInitialised(app);
        state.prepareMaterials(
          app,
          materials as unknown as Materials<M>,
          renderMaterials as unknown as RenderMaterials<M>,
          images as Images,
          renderImages as RenderImages,
        );
      },
      { set: RenderSet.Prepare, after: ['image-prepare'] },
    );

    // Queue: iterate visible (Mesh3d, MeshMaterial3d<M>, GlobalTransform,
    // ViewVisibility) entities × active cameras; batch by (mesh, material);
    // pack per-instance transforms; specialize the pipeline; push one phase
    // item per instanced batch.
    type MmCtor = new (h: MaterialHandle<M>) => MeshMaterial3d<M>;
    type RenderablesQuery = QueryHandle<
      readonly [typeof Mesh3d, MmCtor, typeof GlobalTransform, typeof ViewVisibility]
    >;
    app.addSystem(
      'render',
      [
        Extract(Query([Mesh3d, MeshMaterialCtor, GlobalTransform, ViewVisibility])),
        Res(SortedCameras),
        Res(RenderMaterialsCtor),
        Res(Meshes),
        Res(RenderMeshes),
        Res(MeshAllocator),
        ResMut(ViewPhases3d),
        Res(ViewBindGroupCache),
      ],
      (
        renderables,
        cameras,
        renderMaterials,
        meshes,
        renderMeshes,
        allocator,
        phases,
        viewBindGroupCache,
      ) => {
        state.ensureInitialised(app);
        state.queueMaterials(
          app,
          renderables as unknown as RenderablesQuery,
          cameras as unknown as SortedCameras,
          renderMaterials as unknown as RenderMaterials<M>,
          meshes as unknown as Meshes,
          renderMeshes as unknown as RenderMeshes,
          allocator as unknown as MeshAllocator,
          phases,
          viewBindGroupCache as unknown as ViewBindGroupCache,
        );
      },
      { set: RenderSet.Queue },
    );
  }
}

interface SpecializeContext {
  readonly key: MaterialPipelineKey;
  readonly colorFormat: TextureFormat;
  readonly depthFormat: TextureFormat | undefined;
  readonly depthBias: number;
  readonly layout: VertexBufferLayout;
}

/**
 * Closure-captured per-plugin state. One instance per `MaterialPlugin<M>`.
 *
 * @internal
 */
class MaterialPluginState<M extends Material> {
  /**
   * Buckets whose draw order is significant. 3D opaque / alpha-mask group
   * freely — the depth buffer resolves overlap — so only transparent stays
   * depth-ordered.
   */
  static readonly depthOrderedBuckets: ReadonlySet<AlphaBucket> = new Set<AlphaBucket>(['blend']);

  readonly plugin: MaterialPlugin<M>;
  bindGroupLayout!: BindGroupLayout;
  vertexModule!: ShaderModule;
  fragmentModule!: ShaderModule;
  vertexEntryPoint = 'vs_main';
  fragmentEntryPoint = 'fs_main';
  pipelineLayout: PipelineLayout | undefined;
  specialized!: SpecializedRenderPipelines<SpecializeContext>;
  readonly instanceBuffer = new MeshInstanceBuffer();
  scratch = new ArrayBuffer(1024);
  app!: App;
  initialised = false;

  constructor(plugin: MaterialPlugin<M>) {
    this.plugin = plugin;
  }

  get materialClass(): MaterialCtor<M> {
    return this.plugin.materialClass;
  }

  /**
   * Idempotent GPU-resource bootstrap: build the material's bind-group layout,
   * compile its shaders, allocate its specialization cache. Called from the
   * first prepare/queue tick of every frame — the renderer's device isn't
   * available until `app.run()` awaits `init()`, which happens after every
   * plugin's `build` finishes.
   */
  ensureInitialised(app: App): void {
    if (this.initialised) return;
    this.initialise(app);
    this.initialised = true;
  }

  initialise(app: App): void {
    this.app = app;
    const renderer = app.renderer;
    const cache = app.getResource(PipelineCache);
    const registry = app.getResource(ShaderRegistry);
    if (cache === undefined) {
      throw new Error(
        `MaterialPlugin<${this.materialClass.name}>: PipelineCache resource missing; ShaderPlugin must run before MaterialPlugin.`,
      );
    }
    if (registry === undefined) {
      throw new Error(
        `MaterialPlugin<${this.materialClass.name}>: ShaderRegistry resource missing; ShaderPlugin must run before MaterialPlugin.`,
      );
    }
    this.bindGroupLayout = schemaToBindGroupLayout(
      renderer,
      this.materialClass.bindGroup,
      `material#${this.materialClass.name}`,
    );

    const vertexRef = this.materialClass.vertexShader?.() ?? ({ kind: 'default' } as const);
    const fragmentRef = this.materialClass.fragmentShader?.() ?? ({ kind: 'default' } as const);
    this.vertexModule = compileShaderFromRef(
      cache as PipelineCache,
      registry as ShaderRegistry,
      vertexRef,
      `${this.materialClass.name}-vertex`,
    );
    this.fragmentModule = compileShaderFromRef(
      cache as PipelineCache,
      registry as ShaderRegistry,
      fragmentRef,
      `${this.materialClass.name}-fragment`,
    );

    this.specialized = new SpecializedRenderPipelines<SpecializeContext>(
      cache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) =>
        `${alphaModeKey(ctx.key.alphaMode)}|hdr=${ctx.key.hdr}|msaa=${ctx.key.msaaSamples}|vl=${ctx.key.vertexLayoutDigest}|cf=${ctx.colorFormat}|df=${ctx.depthFormat ?? 'none'}|db=${ctx.depthBias}`,
    );
  }

  prepareMaterials(
    app: App,
    materials: Materials<M>,
    renderMaterials: RenderMaterials<M>,
    images: Images,
    renderImages: RenderImages,
  ): void {
    const events = materials.drainPendingChanges();
    if (events.length === 0) return;
    for (const event of events) {
      if (event.kind === 'removed') {
        renderMaterials.delete(event.handle);
        continue;
      }
      const value = materials.get(event.handle);
      if (value === undefined) continue;
      const previous = renderMaterials.get(event.handle);
      const prepared = prepareBindGroup(
        app.renderer,
        this.materialClass.bindGroup,
        this.bindGroupLayout,
        value as M,
        previous,
        this.scratch,
        images,
        renderImages,
        `material#${this.materialClass.name}#${String(event.handle)}`,
      );
      renderMaterials.set(event.handle, prepared);
    }
  }

  queueMaterials(
    app: App,
    renderables: QueryHandle<
      readonly [typeof Mesh3d, new (...a: never[]) => MeshMaterial3d<M>, typeof GlobalTransform, typeof ViewVisibility]
    >,
    cameras: SortedCameras,
    renderMaterials: RenderMaterials<M>,
    _meshes: Meshes,
    renderMeshes: RenderMeshes,
    allocator: MeshAllocator,
    phases: ViewPhases3d,
    viewBindGroupCache: ViewBindGroupCache,
  ): void {
    if (viewBindGroupCache.layout === undefined) {
      // CameraPlugin.prepareCameras lazily allocates the view layout on first
      // active camera. In a camera-less frame there's nothing to draw.
      return;
    }
    if (cameras.views.length === 0) return;

    const mainWorldMaterials = app.getResource(this.plugin.Materials) as
      | Materials<M>
      | undefined;

    // Collect one entry per (visible entity × view), then batch by
    // (mesh, material). Pipeline / material bind group / mesh slices are
    // constant across a group, so the batch carries them once.
    const entries: InstanceEntry[] = [];
    for (const view of cameras.views) {
      const cameraEntity = view.sourceEntity;
      const colorFormat = view.target.format;
      const depthFormat = view.depth?.format;
      const v = view.viewMatrix as Float32Array;
      for (const row of renderables.entries()) {
        const mesh3d = row[1] as Mesh3d;
        const meshMat = row[2] as MeshMaterial3d<M>;
        const gt = row[3] as GlobalTransform;
        const vis = row[4] as ViewVisibility;
        if (!vis.visible) continue;

        const renderMesh = renderMeshes.get(mesh3d.handle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(mesh3d.handle);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(mesh3d.handle);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(meshMat.handle);
        if (prepared === undefined) continue;

        const materialInstance = mainWorldMaterials?.get(meshMat.handle);
        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;

        const layout = renderMesh.layout.layout;
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: false,
          vertexLayoutDigest: vertexLayoutDigestFor(layout),
          alphaMode,
        };
        const pipeline = this.specialized.get({ key, colorFormat, depthFormat, depthBias, layout });

        // Camera-space depth (negative is in front of the camera; absolute
        // value is monotonic with distance). View-matrix row 2 picks Z out of
        // the world-space position (column-major: m[2], m[6], m[10], m[14]).
        const worldX = gt.matrix[12] as number;
        const worldY = gt.matrix[13] as number;
        const worldZ = gt.matrix[14] as number;
        const sortDepth =
          (v[2] as number) * worldX +
          (v[6] as number) * worldY +
          (v[10] as number) * worldZ +
          (v[14] as number);

        const bucket: AlphaBucket =
          alphaMode === 'opaque' ? 'opaque' : alphaMode === 'blend' ? 'blend' : 'mask';
        entries.push({
          cameraEntity,
          bucket,
          groupKey: `${mesh3d.handle}/${meshMat.handle}`,
          depth: sortDepth,
          model: gt.matrix as Mat4,
          payload: { pipeline, materialBindGroup: prepared.bindGroup, vertexSlice, indexSlice, renderMesh },
        });
      }
    }
    if (entries.length === 0) return;

    // Opaque / alpha-mask group freely (the depth buffer resolves order); only
    // transparent must stay depth-ordered.
    this.instanceBuffer.ensureCapacity(app.renderer, entries.length);
    const { batches, cursorFloats } = packInstancedBatches(
      entries,
      MaterialPluginState.depthOrderedBuckets,
      this.instanceBuffer.scratchF32,
    );
    this.instanceBuffer.count = entries.length;
    const buffer = this.instanceBuffer.buffer!;
    if (cursorFloats > 0) {
      app.renderer.writeBuffer(buffer, 0, this.instanceBuffer.scratchF32.subarray(0, cursorFloats) as unknown as BufferSource);
    }

    for (const batch of batches) {
      const draw = makeInstancedDraw(batch.payload, buffer, batch.firstInstance, batch.count);
      const item: PhaseItem3d = { sourceEntity: batch.cameraEntity, sortDepth: batch.sortDepth, draw };
      if (batch.bucket === 'opaque') {
        phases.pushOpaque(batch.cameraEntity, item);
      } else if (batch.bucket === 'blend') {
        phases.pushTransparent(batch.cameraEntity, item);
      } else {
        phases.pushAlphaMask(batch.cameraEntity, item);
      }
    }
  }

  /**
   * Build a {@link RenderPipelineDescriptor} for a given `SpecializeContext`,
   * threading the material's static `specialize` (when present) over the base
   * descriptor.
   */
  specialize(ctx: SpecializeContext): RenderPipelineDescriptor {
    const renderer = this.app.renderer;
    const viewLayout = (this.app.getResource(ViewBindGroupCache) as ViewBindGroupCache)
      .layout!;

    if (this.pipelineLayout === undefined) {
      this.pipelineLayout = renderer.createPipelineLayout({
        label: `material#${this.materialClass.name}`,
        bindGroupLayouts: [viewLayout, this.bindGroupLayout],
      });
    }

    const isTransparent = ctx.key.alphaMode === 'blend';
    const descriptor: RenderPipelineDescriptor = {
      label: `material#${this.materialClass.name}#${alphaModeKey(ctx.key.alphaMode)}`,
      layout: this.pipelineLayout,
      vertex: {
        module: this.vertexModule,
        entryPoint: this.vertexEntryPoint,
        buffers: [ctx.layout, INSTANCE_LAYOUT],
      },
      fragment: {
        module: this.fragmentModule,
        entryPoint: this.fragmentEntryPoint,
        targets: [
          isTransparent
            ? {
                format: ctx.colorFormat,
                blend: {
                  color: {
                    operation: 'add',
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                  },
                  alpha: {
                    operation: 'add',
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                  },
                },
              }
            : { format: ctx.colorFormat },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back',
        frontFace: 'ccw',
      },
    };
    if (ctx.depthFormat !== undefined) {
      descriptor.depthStencil = {
        format: ctx.depthFormat,
        depthWriteEnabled: !isTransparent,
        depthCompare: 'less',
        depthBias: ctx.depthBias,
      };
    }
    this.materialClass.specialize?.(descriptor, ctx.layout, ctx.key);
    return descriptor;
  }
}

const compileShaderFromRef = (
  cache: PipelineCache,
  registry: ShaderRegistry,
  ref: ShaderRef,
  fallbackLabel: string,
): ShaderModule => {
  if (ref.kind === 'default') {
    throw new Error(
      `MaterialPlugin: '${fallbackLabel}' resolved to ShaderRef.default(); material classes must override static vertexShader()/fragmentShader() for Phase 7 — engine builtins land alongside the asset system.`,
    );
  }
  const source = registry.get(ref.name);
  if (source === undefined) {
    throw new Error(
      `MaterialPlugin: shader module '${ref.name}' is not registered with ShaderRegistry; register it from the material's plugin or before adding the plugin.`,
    );
  }
  return cache.compileShader(new Shader(source, { label: ref.name }));
};

const vertexLayoutDigestCache = new WeakMap<VertexBufferLayout, string>();
const vertexLayoutDigestFor = (layout: VertexBufferLayout): string => {
  const cached = vertexLayoutDigestCache.get(layout);
  if (cached !== undefined) return cached;
  const digest =
    `${layout.arrayStride}/${layout.stepMode ?? 'vertex'}/` +
    layout.attributes
      .map((a) => `${a.shaderLocation}:${a.format}@${a.offset}`)
      .join(';');
  vertexLayoutDigestCache.set(layout, digest);
  return digest;
};

// Suppress unused-binding lint: the marker types `PreparedMaterial` and
// `MeshHandle` are imported for documentation TSDoc links above but not
// referenced in this module's runtime code.
void (null as unknown as PreparedMaterial);
void (null as unknown as MeshHandle);
