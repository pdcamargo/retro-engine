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
import { MeshTransformGcPlugin } from '../material/gc-entity-transforms';
import type { AlphaMode } from '../material/material';
import type { MaterialHandle } from '../material/materials';
import { Materials } from '../material/materials';
import {
  EntityTransformGpuCache,
  ensureEntityTransform,
} from '../material/mesh-3d-transforms';
import type { PreparedMaterial } from '../material/prepare-bind-group';
import {
  prepareBindGroup,
  schemaToBindGroupLayout,
} from '../material/prepare-bind-group';
import { RenderMaterials } from '../material/render-materials';
import type { AllocatorSlice, MeshHandle, RenderMesh } from '../mesh';
import { Mesh2d, MeshAllocator, Meshes, RenderMeshes } from '../mesh';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { Core2dLabel } from '../render-graph/core-2d';
import type { PhaseItem2d } from '../render-graph/phase-2d';
import { ViewPhases2d } from '../render-graph/phase-2d';
import { PipelineCache } from '../shader/pipeline-cache';
import { Shader } from '../shader/shader';
import { ShaderRegistry } from '../shader/shader-registry';
import { SpecializedRenderPipelines } from '../shader/specialized-render-pipeline';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import type {
  Material2d,
  Material2dCtor,
  MaterialPipelineKey2d,
} from './material-2d';
import { MeshMaterial2d } from './mesh-material-2d';

/** Optional configuration for {@link Material2dPlugin}. None for Phase 8.7. */
export type Material2dPluginOptions = Record<string, never>;

/**
 * Engine plugin owning one Material2d type's data + draw pipeline.
 *
 * Construct with the material class:
 *
 * ```ts
 * const color = new Material2dPlugin(ColorMaterial2d);
 * app.addPlugin(new ColorMaterial2dPlugin()); // registers the WGSL
 * app.addPlugin(color);
 * const handle = world.getResource(color.Materials2d)!.add(new ColorMaterial2d(...));
 * world.spawn(new Mesh2d(meshHandle), new color.MeshMaterial2d(handle));
 * ```
 *
 * On `build`, the plugin:
 *
 * - Synthesises per-material-type subclasses of {@link Materials},
 *   {@link RenderMaterials}, and {@link MeshMaterial2d} so the engine's
 *   class-keyed ECS / resource store can disambiguate per-material registries
 *   at runtime despite TypeScript's erased generics.
 * - Inserts the `Materials2d<M>` resource (main world) and `RenderMaterials2d<M>`
 *   resource (render world).
 * - Inserts the shared {@link EntityTransformGpuCache} resource and registers
 *   the {@link MeshTransformGcPlugin} (idempotent — re-adding via a second
 *   `Material2dPlugin` / `MaterialPlugin` is a no-op).
 * - Inserts the shared {@link ViewPhases2d} resource (idempotent — shared with
 *   `SpritePlugin`).
 * - Builds the material's `BindGroupLayout` from `M.bindGroup`.
 * - Resolves vertex / fragment shaders against `ShaderRegistry` via the
 *   material's `vertexShader()` / `fragmentShader()` `ShaderRef`s.
 * - Caches a {@link SpecializedRenderPipelines}`<MaterialPipelineKey2d>` that
 *   varies pipeline state by `(surfaceFormat, msaaSamples, hdr, alphaBucket)`.
 * - Registers prepare + queue systems: prepare drains `Materials2d<M>` events
 *   and populates `RenderMaterials2d<M>`; queue iterates visible
 *   `(Mesh2d, MeshMaterial2d<M>, GlobalTransform, ViewVisibility)` rows against
 *   each 2D camera and pushes phase items into {@link ViewPhases2d}.
 *
 * Not unique — instantiate one per material type. Re-instantiating for the
 * same material type throws at `build()`.
 */
export class Material2dPlugin<M extends Material2d> implements PluginObject {
  readonly materialClass: Material2dCtor<M>;
  /** Per-type subclass of {@link Materials} — register / look up via this constructor. */
  readonly Materials2d: new () => Materials<M>;
  /** Per-type subclass of {@link RenderMaterials} — render-world prepared bind groups. */
  readonly RenderMaterials2d: new () => RenderMaterials<M>;
  /** Per-type subclass of {@link MeshMaterial2d} — spawn `new plugin.MeshMaterial2d(handle)`. */
  readonly MeshMaterial2d: new (handle: MaterialHandle<M>) => MeshMaterial2d<M>;

  constructor(materialClass: Material2dCtor<M>, _options?: Material2dPluginOptions) {
    this.materialClass = materialClass;

    const MaterialsBase = Materials as unknown as new () => Materials<M>;
    const MaterialsSubclass = class extends MaterialsBase {};
    Object.defineProperty(MaterialsSubclass, 'name', {
      value: `Materials2d<${materialClass.name}>`,
    });
    this.Materials2d = MaterialsSubclass as unknown as new () => Materials<M>;

    const RenderMaterialsBase = RenderMaterials as unknown as new () => RenderMaterials<M>;
    const RenderMaterialsSubclass = class extends RenderMaterialsBase {};
    Object.defineProperty(RenderMaterialsSubclass, 'name', {
      value: `RenderMaterials2d<${materialClass.name}>`,
    });
    this.RenderMaterials2d = RenderMaterialsSubclass as unknown as new () => RenderMaterials<M>;

    const MeshMaterialBase = MeshMaterial2d as unknown as new (
      h: MaterialHandle<M>,
    ) => MeshMaterial2d<M>;
    const MeshMaterialSubclass = class extends MeshMaterialBase {};
    Object.defineProperty(MeshMaterialSubclass, 'name', {
      value: `MeshMaterial2d<${materialClass.name}>`,
    });
    this.MeshMaterial2d = MeshMaterialSubclass as unknown as new (
      h: MaterialHandle<M>,
    ) => MeshMaterial2d<M>;
  }

  name(): string {
    return `Material2dPlugin<${this.materialClass.name}>`;
  }

  isUnique(): boolean {
    return false;
  }

  build(app: App): void {
    if (app.getResource(this.Materials2d) !== undefined) {
      throw new Error(
        `${this.name()}: a Materials2d registry for this material type is already installed; do not add the same Material2dPlugin twice.`,
      );
    }
    app.insertResource(new this.Materials2d());
    app.insertResource(new this.RenderMaterials2d());
    if (app.getResource(EntityTransformGpuCache) === undefined) {
      app.insertResource(new EntityTransformGpuCache());
    }
    app.addPlugin(new MeshTransformGcPlugin());
    if (app.getResource(ViewPhases2d) === undefined) {
      app.insertResource(new ViewPhases2d());
    }

    const state = new Material2dPluginState(this);

    const MaterialsCtor = this.Materials2d;
    const RenderMaterialsCtor = this.RenderMaterials2d;
    const MeshMaterialCtor = this.MeshMaterial2d;

    // Prepare: drain Materials2d<M> events; for added/modified, build or
    // rebuild the per-handle PreparedMaterial in RenderMaterials2d<M>; for
    // removed, destroy and drop. `after: ['image-prepare']` mirrors
    // MaterialPlugin so any future textured Material2d can resolve image
    // handles in the same frame they're inserted.
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

    // Queue: iterate visible (Mesh2d, MeshMaterial2d<M>, GlobalTransform,
    // ViewVisibility) entities × active 2D cameras; build per-entity transform
    // bind groups (shared with 3D via the same cache); specialize the pipeline;
    // push phase items into ViewPhases2d.
    type MmCtor = new (h: MaterialHandle<M>) => MeshMaterial2d<M>;
    type RenderablesQuery = QueryHandle<
      readonly [typeof Mesh2d, MmCtor, typeof GlobalTransform, typeof ViewVisibility]
    >;
    app.addSystem(
      'render',
      [
        Extract(Query([Mesh2d, MeshMaterialCtor, GlobalTransform, ViewVisibility])),
        Res(SortedCameras),
        Res(RenderMaterialsCtor),
        Res(Meshes),
        Res(RenderMeshes),
        Res(MeshAllocator),
        ResMut(EntityTransformGpuCache),
        ResMut(ViewPhases2d),
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

const alphaBucketOf = (mode: AlphaMode): 'opaque' | 'mask' | 'blend' => {
  if (mode === 'opaque') return 'opaque';
  if (mode === 'blend') return 'blend';
  return 'mask';
};

interface SpecializeContext2d {
  readonly key: MaterialPipelineKey2d;
  readonly layout: VertexBufferLayout;
}

/**
 * Closure-captured per-plugin state. One instance per `Material2dPlugin<M>`.
 *
 * @internal
 */
class Material2dPluginState<M extends Material2d> {
  readonly plugin: Material2dPlugin<M>;
  bindGroupLayout!: BindGroupLayout;
  vertexModule!: ShaderModule;
  fragmentModule!: ShaderModule;
  vertexEntryPoint = 'vs_main';
  fragmentEntryPoint = 'fs_main';
  pipelineLayout: PipelineLayout | undefined;
  specialized!: SpecializedRenderPipelines<SpecializeContext2d>;
  scratch = new ArrayBuffer(1024);
  app!: App;
  initialised = false;

  constructor(plugin: Material2dPlugin<M>) {
    this.plugin = plugin;
  }

  get materialClass(): Material2dCtor<M> {
    return this.plugin.materialClass;
  }

  /**
   * Idempotent GPU-resource bootstrap. Called from the first prepare/queue
   * tick of every frame — the renderer's device isn't available until
   * `app.run()` awaits `init()`, which happens after every plugin's `build`
   * finishes.
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
        `Material2dPlugin<${this.materialClass.name}>: PipelineCache resource missing; ShaderPlugin must run before Material2dPlugin.`,
      );
    }
    if (registry === undefined) {
      throw new Error(
        `Material2dPlugin<${this.materialClass.name}>: ShaderRegistry resource missing; ShaderPlugin must run before Material2dPlugin.`,
      );
    }
    this.bindGroupLayout = schemaToBindGroupLayout(
      renderer,
      this.materialClass.bindGroup,
      `material-2d#${this.materialClass.name}`,
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

    this.specialized = new SpecializedRenderPipelines<SpecializeContext2d>(
      cache as PipelineCache,
      (ctx) => this.specialize(ctx),
      (ctx) =>
        `${ctx.key.alphaBucket}|hdr=${ctx.key.hdr}|msaa=${ctx.key.msaaSamples}|sf=${ctx.key.surfaceFormat}|mk=${ctx.key.materialKey ?? ''}`,
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
        `material-2d#${this.materialClass.name}#${String(event.handle)}`,
      );
      renderMaterials.set(event.handle, prepared);
    }
  }

  queueMaterials(
    app: App,
    renderables: QueryHandle<
      readonly [typeof Mesh2d, new (...a: never[]) => MeshMaterial2d<M>, typeof GlobalTransform, typeof ViewVisibility]
    >,
    cameras: SortedCameras,
    renderMaterials: RenderMaterials<M>,
    _meshes: Meshes,
    renderMeshes: RenderMeshes,
    allocator: MeshAllocator,
    entityTransforms: EntityTransformGpuCache,
    phases: ViewPhases2d,
    viewBindGroupCache: ViewBindGroupCache,
  ): void {
    entityTransforms.getOrCreateLayout(app.renderer);
    if (viewBindGroupCache.layout === undefined) return;
    if (cameras.views.length === 0) return;

    const mainWorldMaterials = app.getResource(this.plugin.Materials2d) as
      | Materials<M>
      | undefined;

    for (const view of cameras.views) {
      if (view.subGraph !== Core2dLabel) continue;
      const cameraEntity = view.sourceEntity;
      const surfaceFormat = view.target.format;
      const v = view.viewMatrix as Float32Array;

      for (const row of renderables.entries()) {
        const entity = row[0] as Entity;
        const mesh2d = row[1] as Mesh2d;
        const meshMat = row[2] as MeshMaterial2d<M>;
        const gt = row[3] as GlobalTransform;
        const vis = row[4] as ViewVisibility;
        if (!vis.visible) continue;

        const renderMesh = renderMeshes.get(mesh2d.handle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(mesh2d.handle);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(mesh2d.handle);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(meshMat.handle);
        if (prepared === undefined) continue;

        const entityBindGroup = ensureEntityTransform(
          entityTransforms,
          app.renderer,
          entity,
          gt.matrix as Mat4,
        );

        const materialInstance = mainWorldMaterials?.get(meshMat.handle);
        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const alphaBucket = alphaBucketOf(alphaMode);

        const key: MaterialPipelineKey2d = {
          surfaceFormat,
          msaaSamples: 1,
          hdr: false,
          alphaBucket,
        };
        const pipeline = this.specialized.get({
          key,
          layout: renderMesh.layout.layout,
        });

        // Full 4-term camera-space-Z computation (mirrors MaterialPlugin's
        // 3D path; not the sprite plugin's 2-term shortcut). The extra two
        // terms are zero for an axis-aligned ortho Camera2d but non-zero
        // for a tilted Camera2d — which custom plugins are free to spawn.
        const worldX = gt.matrix[12] as number;
        const worldY = gt.matrix[13] as number;
        const worldZ = gt.matrix[14] as number;
        const sortDepth =
          (v[2] as number) * worldX +
          (v[6] as number) * worldY +
          (v[10] as number) * worldZ +
          (v[14] as number);

        const draw = makeDraw2dClosure({
          pipeline,
          entityBindGroup,
          materialBindGroup: prepared.bindGroup,
          vertexSlice,
          indexSlice,
          renderMesh,
        });

        const item: PhaseItem2d = { sourceEntity: entity, sortDepth, draw };
        if (alphaBucket === 'opaque') {
          phases.pushOpaque(cameraEntity, item);
        } else if (alphaBucket === 'mask') {
          phases.pushAlphaMask(cameraEntity, item);
        } else {
          phases.pushTransparent(cameraEntity, item);
        }
      }
    }
  }

  /**
   * Build a {@link RenderPipelineDescriptor} for a given specialization
   * context. Mirrors the 3D MaterialPlugin's specialize, with no depth-stencil
   * (Core2d has no depth attachment) and an alpha-bucket-driven blend state.
   */
  specialize(ctx: SpecializeContext2d): RenderPipelineDescriptor {
    const renderer = this.app.renderer;
    const entityTransformLayout = this.app
      .getResource(EntityTransformGpuCache)!
      .getOrCreateLayout(renderer);
    const viewLayout = (this.app.getResource(ViewBindGroupCache) as ViewBindGroupCache)
      .layout!;

    if (this.pipelineLayout === undefined) {
      this.pipelineLayout = renderer.createPipelineLayout({
        label: `material-2d#${this.materialClass.name}`,
        bindGroupLayouts: [viewLayout, entityTransformLayout, this.bindGroupLayout],
      });
    }

    const isTransparent = ctx.key.alphaBucket === 'blend';
    const descriptor: RenderPipelineDescriptor = {
      label: `material-2d#${this.materialClass.name}#${ctx.key.alphaBucket}`,
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
                format: ctx.key.surfaceFormat,
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
            : { format: ctx.key.surfaceFormat },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'ccw',
      },
    };
    this.materialClass.specialize?.(descriptor, ctx.layout, ctx.key);
    return descriptor;
  }
}

const compileShaderFromRef = (
  cache: PipelineCache,
  registry: ShaderRegistry,
  ref: { readonly kind: 'default' } | { readonly kind: 'module'; readonly name: string },
  fallbackLabel: string,
): ShaderModule => {
  if (ref.kind === 'default') {
    throw new Error(
      `Material2dPlugin: '${fallbackLabel}' resolved to ShaderRef.default(); material classes must override static vertexShader()/fragmentShader() — the engine ships no default 2D shader.`,
    );
  }
  const source = registry.get(ref.name);
  if (source === undefined) {
    throw new Error(
      `Material2dPlugin: shader module '${ref.name}' is not registered with ShaderRegistry; register it from the material's plugin or before adding the plugin.`,
    );
  }
  return cache.compileShader(new Shader(source, { label: ref.name }));
};

interface DrawClosureArgs {
  pipeline: RenderPipeline;
  entityBindGroup: BindGroup;
  materialBindGroup: BindGroup;
  vertexSlice: AllocatorSlice;
  indexSlice: AllocatorSlice | undefined;
  renderMesh: RenderMesh;
}

const makeDraw2dClosure =
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

// Suppress unused-binding lint: imported for documentation TSDoc references.
void (null as unknown as PreparedMaterial);
void (null as unknown as MeshHandle);
void (null as unknown as TextureFormat);
