import type { Entity, Query as QueryHandle } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import type {
  BindGroup,
  BindGroupLayout,
  PipelineLayout,
  RenderPassEncoder,
  RenderPipeline,
  RenderPipelineDescriptor,
  ShaderModule,
  TextureFormat,
  VertexBufferLayout,
} from '@retro-engine/renderer-core';

import { ViewBindGroupCache } from '../camera/extracted';
import { SortedCameras } from '../camera/sorted-cameras';
import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import type { App, RenderContext } from '../index';
import type { AllocatorSlice, MeshHandle, RenderMesh } from '../mesh';
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
import {
  EntityTransformGpuCache,
  ensureEntityTransform,
  gcEntityTransforms,
} from './mesh-3d-transforms';
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
 * - Inserts a shared {@link EntityTransformGpuCache} resource (idempotent —
 *   re-adding via a second `MaterialPlugin` is a no-op).
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
    if (app.getResource(EntityTransformGpuCache) === undefined) {
      app.insertResource(new EntityTransformGpuCache());
    }
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
    // ViewVisibility) entities × active cameras; build per-entity transform
    // bind groups; specialize the pipeline; push phase items.
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
        ResMut(EntityTransformGpuCache),
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
        entityTransforms,
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
          entityTransforms,
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
  readonly plugin: MaterialPlugin<M>;
  bindGroupLayout!: BindGroupLayout;
  vertexModule!: ShaderModule;
  fragmentModule!: ShaderModule;
  vertexEntryPoint = 'vs_main';
  fragmentEntryPoint = 'fs_main';
  pipelineLayout: PipelineLayout | undefined;
  specialized!: SpecializedRenderPipelines<SpecializeContext>;
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
    entityTransforms: EntityTransformGpuCache,
    phases: ViewPhases3d,
    viewBindGroupCache: ViewBindGroupCache,
  ): void {
    // Ensure entity-transform layout exists before any pipeline is built —
    // specialize() reads it. Calling getOrCreateLayout is idempotent.
    entityTransforms.getOrCreateLayout(app.renderer);
    if (viewBindGroupCache.layout === undefined) {
      // CameraPlugin.prepareCameras lazily allocates the view layout on first
      // active camera. In a camera-less frame there's nothing to draw.
      return;
    }
    if (cameras.views.length === 0) return;

    const liveEntities = new Set<Entity>();
    const mainWorldMaterials = app.getResource(this.plugin.Materials) as
      | Materials<M>
      | undefined;

    for (const view of cameras.views) {
      const cameraEntity = view.sourceEntity;
      for (const row of renderables.entries()) {
        const entity = row[0] as Entity;
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

        liveEntities.add(entity);
        const entityBindGroup = ensureEntityTransform(
          entityTransforms,
          app.renderer,
          entity,
          gt.matrix as Mat4,
        );

        const materialInstance = mainWorldMaterials?.get(meshMat.handle);
        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;

        const layout = renderMesh.layout.layout;
        const vertexLayoutDigest = vertexLayoutDigestFor(layout);
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: false,
          vertexLayoutDigest,
          alphaMode,
        };
        const colorFormat = view.target.format;
        const depthFormat = view.depth?.format;
        const pipeline = this.specialized.get({
          key,
          colorFormat,
          depthFormat,
          depthBias,
          layout,
        });

        // Camera-space depth (negative is in front of the camera; absolute
        // value is monotonic with distance). Use the row that picks Z out of
        // the world-space position: view-matrix row 2 (column-major: m[2],
        // m[6], m[10], m[14]).
        const worldX = gt.matrix[12] as number;
        const worldY = gt.matrix[13] as number;
        const worldZ = gt.matrix[14] as number;
        const v = view.viewMatrix as Float32Array;
        const sortDepth =
          (v[2] as number) * worldX +
          (v[6] as number) * worldY +
          (v[10] as number) * worldZ +
          (v[14] as number);

        const draw = makeDrawClosure({
          pipeline,
          entityBindGroup,
          materialBindGroup: prepared.bindGroup,
          vertexSlice,
          indexSlice,
          renderMesh,
        });

        const item: PhaseItem3d = { sourceEntity: entity, sortDepth, draw };
        if (alphaMode === 'opaque') {
          phases.pushOpaque(cameraEntity, item);
        } else if (alphaMode === 'blend') {
          phases.pushTransparent(cameraEntity, item);
        } else {
          phases.pushAlphaMask(cameraEntity, item);
        }
      }
    }
    gcEntityTransforms(entityTransforms, liveEntities);
  }

  /**
   * Build a {@link RenderPipelineDescriptor} for a given `SpecializeContext`,
   * threading the material's static `specialize` (when present) over the base
   * descriptor.
   */
  specialize(ctx: SpecializeContext): RenderPipelineDescriptor {
    const renderer = this.app.renderer;
    const entityTransformLayout = this.app
      .getResource(EntityTransformGpuCache)!
      .getOrCreateLayout(renderer);
    const viewLayout = (this.app.getResource(ViewBindGroupCache) as ViewBindGroupCache)
      .layout!;

    if (this.pipelineLayout === undefined) {
      this.pipelineLayout = renderer.createPipelineLayout({
        label: `material#${this.materialClass.name}`,
        bindGroupLayouts: [viewLayout, entityTransformLayout, this.bindGroupLayout],
      });
    }

    const isTransparent = ctx.key.alphaMode === 'blend';
    const descriptor: RenderPipelineDescriptor = {
      label: `material#${this.materialClass.name}#${alphaModeKey(ctx.key.alphaMode)}`,
      layout: this.pipelineLayout,
      vertex: {
        module: this.vertexModule,
        entryPoint: this.vertexEntryPoint,
        buffers: [ctx.layout],
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

interface DrawClosureArgs {
  pipeline: RenderPipeline;
  entityBindGroup: BindGroup;
  materialBindGroup: BindGroup;
  vertexSlice: AllocatorSlice;
  indexSlice: AllocatorSlice | undefined;
  renderMesh: RenderMesh;
}

const makeDrawClosure =
  ({
    pipeline,
    entityBindGroup,
    materialBindGroup,
    vertexSlice,
    indexSlice,
    renderMesh,
  }: DrawClosureArgs) =>
  (pass: RenderPassEncoder, _ctx: RenderContext): void => {
    pass.setPipeline(pipeline);
    pass.setBindGroup(1, entityBindGroup);
    pass.setBindGroup(2, materialBindGroup);
    // Slab-allocated meshes share one vertex / index buffer; the slot is
    // picked via `baseVertex` (added to every index read) and `firstIndex`
    // (offset into the index buffer in elements). Binding at `slice.offset`
    // bytes AND adding `baseVertex` would double-count and read past the
    // slot. Bind the whole slab at offset 0 and rely on the indices —
    // matches the pattern AllocatorSlice's TSDoc documents.
    pass.setVertexBuffer(0, vertexSlice.buffer);
    if (renderMesh.bufferInfo.kind === 'indexed') {
      const idx = indexSlice!;
      pass.setIndexBuffer(idx.buffer, renderMesh.bufferInfo.indexFormat);
      pass.drawIndexed(
        renderMesh.bufferInfo.indexCount,
        1,
        idx.baseVertex,
        vertexSlice.baseVertex,
        0,
      );
    } else {
      pass.draw(renderMesh.vertexCount, 1, vertexSlice.baseVertex, 0);
    }
  };

// Suppress unused-binding lint: the marker types `PreparedMaterial` and
// `MeshHandle` are imported for documentation TSDoc links above but not
// referenced in this module's runtime code.
void (null as unknown as PreparedMaterial);
void (null as unknown as MeshHandle);
