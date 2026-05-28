import type { ComponentType, Entity, Query as QueryHandle } from '@retro-engine/ecs';
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
import { GpuLights } from '../light3d/gpu-lights';
import type { App } from '../index';
import type { AllocatorSlice, MeshHandle } from '../mesh';
import { MeshAllocator, Meshes, Mesh3d, RenderMeshes } from '../mesh';
import type { PluginObject } from '../plugin';
import { intersectPrepassFlags, prepassFlagsAny, type PrepassFlags } from '../prepass/components';
import { PrepassFlagsByCamera } from '../prepass/prepass-plugin';
import { PREPASS_NORMAL_FORMAT } from '../prepass/view-prepass-targets';
import { RenderSet } from '../render-set';
import { Core3dLabel } from '../render-graph/core-3d';
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
import type { AlphaBucket, InstanceEntry, InstancedDrawPayload } from './instance-batching';
import { makeInstancedDraw, packInstancedBatches } from './instance-batching';
import { prepareMeshRetained, RetainedMeshBuffer } from './mesh-prepare-retained';
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
  /**
   * When `true`, the material is lit: {@link MaterialPlugin} appends the
   * engine's `GpuLights` bind-group layout to the pipeline layout at
   * `@group(2)` so the fragment shader can read the analytic lights, and the
   * Core3d phase nodes bind it. Requires a `Light3dPlugin`. Omit (or `false`)
   * for unlit materials, whose layout stays `[view, material]`.
   */
  readonly usesLights?: boolean;
  vertexShader?(): ShaderRef;
  fragmentShader?(): ShaderRef;
  specialize?(
    descriptor: RenderPipelineDescriptor,
    vertexLayout: VertexBufferLayout,
    key: MaterialPipelineKey,
  ): void;
}

/** Optional configuration for {@link MaterialPlugin}. */
export interface MaterialPluginOptions {
  /**
   * Use the retained, change-gated instance prepare path (incremental uploads)
   * instead of the per-frame full repack. Defaults to `false`.
   */
  readonly retained?: boolean;
}

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
  private readonly retained: boolean;

  constructor(materialClass: MaterialCtor<M>, options?: MaterialPluginOptions) {
    this.materialClass = materialClass;
    this.retained = options?.retained ?? false;

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
      { set: RenderSet.Prepare, label: 'material-prepare', after: ['image-prepare'] },
    );

    if (this.retained) {
      this.registerRetained(app, state, MeshMaterialCtor, RenderMaterialsCtor);
      return;
    }

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
          app.getResource(PrepassFlagsByCamera),
        );
      },
      { set: RenderSet.Queue },
    );
  }

  /**
   * Register the retained, change-gated instance prepare + a thin queue that
   * emits phase items from the per-camera ordered buffers.
   */
  private registerRetained(
    app: App,
    state: MaterialPluginState<M>,
    MeshMaterialCtor: new (h: MaterialHandle<M>) => MeshMaterial3d<M>,
    RenderMaterialsCtor: new () => RenderMaterials<M>,
  ): void {
    app.addSystem(
      'render',
      [Res(SortedCameras), Res(RenderMaterialsCtor), Res(RenderMeshes), Res(MeshAllocator)],
      (cameras, renderMaterials, renderMeshes, allocator) => {
        state.ensureInitialised(app);
        prepareMeshRetained(app.world, app.renderer, state.retainedBuffer, {
          meshType: Mesh3d as unknown as ComponentType,
          materialType: MeshMaterialCtor as unknown as ComponentType,
          cameras: cameras as unknown as SortedCameras,
          subGraphLabel: Core3dLabel,
          deps: {
            renderMeshes: renderMeshes as unknown as RenderMeshes,
            allocator: allocator as unknown as MeshAllocator,
            renderMaterials: renderMaterials as unknown as RenderMaterials<M>,
            mainWorldMaterials: app.getResource(this.Materials),
          },
        });
      },
      { set: RenderSet.Prepare, label: 'material-instance-prepare', after: ['material-prepare'] },
    );

    app.addSystem(
      'render',
      [
        Res(SortedCameras),
        Res(RenderMaterialsCtor),
        Res(RenderMeshes),
        Res(MeshAllocator),
        ResMut(ViewPhases3d),
        Res(ViewBindGroupCache),
      ],
      (cameras, renderMaterials, renderMeshes, allocator, phases, viewBindGroupCache) => {
        state.ensureInitialised(app);
        state.queueMaterialsRetained(
          app,
          cameras as unknown as SortedCameras,
          renderMaterials as unknown as RenderMaterials<M>,
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

const prepassKeyPart = (flags: PrepassFlags | undefined): string => {
  if (flags === undefined) return 'pp=none';
  return `pp=${flags.depth ? 'd' : ''}${flags.normal ? 'n' : ''}${flags.motionVector ? 'm' : ''}`;
};

const prepassReadableKeyPart = (
  flags: { normal: boolean; motionVector: boolean } | undefined,
): string => {
  if (flags === undefined) return 'pr=none';
  return `pr=${flags.normal ? 'n' : ''}${flags.motionVector ? 'm' : ''}`;
};

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
  prepassPipelineLayout: PipelineLayout | undefined;
  specialized!: SpecializedRenderPipelines<SpecializeContext>;
  readonly instanceBuffer = new MeshInstanceBuffer();
  readonly retainedBuffer = new RetainedMeshBuffer<M>(MaterialPluginState.depthOrderedBuckets);
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
        `${alphaModeKey(ctx.key.alphaMode)}|hdr=${ctx.key.hdr}|msaa=${ctx.key.msaaSamples}|vl=${ctx.key.vertexLayoutDigest}|cf=${ctx.colorFormat}|df=${ctx.depthFormat ?? 'none'}|db=${ctx.depthBias}|${prepassKeyPart(ctx.key.prepass)}|${prepassReadableKeyPart(ctx.key.prepassReadable)}`,
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
    prepassFlagsByCamera?: PrepassFlagsByCamera,
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
      const colorFormat = view.mainColorTarget.format;
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
          hdr: view.hdr,
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

    // Prepass: per-camera, per-material opt-in. For every camera with at
    // least one prepass marker we walk the same entries collected above,
    // re-key on the prepass flag intersection, and push items into
    // `phases.prepass` using a depth-only (or, in later steps, depth +
    // normal / motion-vector) pipeline variant. The instance buffer is
    // **reused** — both the opaque and prepass batches index into the same
    // packed transforms, so we pay zero extra upload for the prepass.
    if (prepassFlagsByCamera === undefined || prepassFlagsByCamera.map.size === 0) return;
    this.queuePrepassFromEntries(
      app,
      entries,
      cameras,
      mainWorldMaterials,
      phases,
      prepassFlagsByCamera,
      buffer,
    );
  }

  private queuePrepassFromEntries(
    _app: App,
    entries: readonly InstanceEntry[],
    cameras: SortedCameras,
    mainWorldMaterials: Materials<M> | undefined,
    phases: ViewPhases3d,
    prepassFlagsByCamera: PrepassFlagsByCamera,
    instanceBuffer: import('@retro-engine/renderer-core').Buffer,
  ): void {
    // Per-camera enabled flags lookup keeps the cost O(views) at the start.
    const flagsByEntity = prepassFlagsByCamera.map;
    const liveCameraFlags = new Map<number, PrepassFlags>();
    for (const view of cameras.views) {
      const sourceEntity = view.sourceEntity as unknown as Entity;
      const f = flagsByEntity.get(sourceEntity);
      if (f !== undefined) liveCameraFlags.set(view.sourceEntity, f);
    }
    if (liveCameraFlags.size === 0) return;

    // Re-key each entry against its camera's enabled prepass flags ∩ the
    // material's `prepassWrites()`; emit a prepass entry only when the
    // intersection has at least one channel set. The mesh / instance slice /
    // material bind group are shared with the opaque entry; only the
    // pipeline differs.
    const prepassEntries: InstanceEntry[] = [];
    for (const entry of entries) {
      const cameraFlags = liveCameraFlags.get(entry.cameraEntity);
      if (cameraFlags === undefined) continue;
      // Recover the material handle from the groupKey ("meshHandle/materialHandle").
      const slash = entry.groupKey.indexOf('/');
      const materialHandle = Number(
        entry.groupKey.slice(slash + 1),
      ) as unknown as MaterialHandle<M>;
      const materialInstance = mainWorldMaterials?.get(materialHandle);
      const matFlags = materialInstance?.prepassWrites?.();
      if (matFlags === undefined) continue;
      const flags = intersectPrepassFlags(cameraFlags, matFlags);
      if (!prepassFlagsAny(flags)) continue;

      // Build the prepass pipeline for this entry's mesh layout + intersected
      // flags. The opaque entry's payload exposes the renderMesh which
      // carries the original layout digest.
      const view = cameras.views.find((v) => (v.sourceEntity as number) === entry.cameraEntity);
      if (view === undefined) continue;
      const depthFormat = view.depth?.format;
      const colorFormat = view.mainColorTarget.format;
      const layout = entry.payload.renderMesh.layout.layout;
      const key: MaterialPipelineKey = {
        msaaSamples: 1,
        hdr: view.hdr,
        vertexLayoutDigest: vertexLayoutDigestFor(layout),
        alphaMode: 'opaque',
        prepass: flags,
      };
      const depthBias = materialInstance?.depthBias?.() ?? 0;
      const pipeline = this.specialized.get({ key, colorFormat, depthFormat, depthBias, layout });
      prepassEntries.push({
        cameraEntity: entry.cameraEntity,
        bucket: 'opaque',
        groupKey: entry.groupKey,
        depth: entry.depth,
        model: entry.model,
        payload: {
          pipeline,
          materialBindGroup: entry.payload.materialBindGroup,
          vertexSlice: entry.payload.vertexSlice,
          indexSlice: entry.payload.indexSlice,
          renderMesh: entry.payload.renderMesh,
        },
      });
    }
    if (prepassEntries.length === 0) return;
    // Re-pack into batches; instance ordering matches the opaque pack, so
    // both batch sets index into the same shared `instanceBuffer` slices.
    // The packer writes into `scratchF32`, but we ignore those bytes — we
    // pass the SAME `instanceBuffer` and rely on the firstInstance/count
    // pairing matching what the opaque pack wrote.
    const { batches } = packInstancedBatches(
      prepassEntries,
      MaterialPluginState.depthOrderedBuckets,
      this.instanceBuffer.scratchF32,
    );
    for (const batch of batches) {
      const draw = makeInstancedDraw(
        batch.payload,
        instanceBuffer,
        batch.firstInstance,
        batch.count,
      );
      const item: PhaseItem3d = {
        sourceEntity: batch.cameraEntity,
        sortDepth: batch.sortDepth,
        draw,
      };
      phases.pushPrepass(batch.cameraEntity, item);
    }
  }

  /**
   * Retained-path queue: emit one phase item per batch in each Core3d camera's
   * retained ordered buffer. Payloads (pipeline, bind group, mesh slices) are
   * resolved per batch — O(batches), not O(instances) — and the instance bytes
   * come from the retained buffer the prepare step maintains.
   */
  queueMaterialsRetained(
    app: App,
    cameras: SortedCameras,
    renderMaterials: RenderMaterials<M>,
    renderMeshes: RenderMeshes,
    allocator: MeshAllocator,
    phases: ViewPhases3d,
    viewBindGroupCache: ViewBindGroupCache,
  ): void {
    if (viewBindGroupCache.layout === undefined) return;
    if (cameras.views.length === 0) return;
    const mainWorldMaterials = app.getResource(this.plugin.Materials) as Materials<M> | undefined;

    for (const view of cameras.views) {
      if (view.subGraph !== Core3dLabel) continue;
      const index = this.retainedBuffer.indexByCamera.get(view.sourceEntity as Entity);
      if (index === undefined) continue;
      const buffer = index.ordered.buffer;
      if (buffer === undefined) continue;
      const colorFormat = view.mainColorTarget.format;
      const depthFormat = view.depth?.format;

      for (const batch of index.batches) {
        const { meshHandle, materialHandle, bucket, depth } = batch.key;
        const renderMesh = renderMeshes.get(meshHandle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(meshHandle);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(meshHandle);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(materialHandle);
        if (prepared === undefined) continue;

        const materialInstance = mainWorldMaterials?.get(materialHandle);
        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;
        const layout = renderMesh.layout.layout;
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: view.hdr,
          vertexLayoutDigest: vertexLayoutDigestFor(layout),
          alphaMode,
        };
        const pipeline = this.specialized.get({ key, colorFormat, depthFormat, depthBias, layout });
        const payload: InstancedDrawPayload = {
          pipeline,
          materialBindGroup: prepared.bindGroup,
          vertexSlice,
          indexSlice,
          renderMesh,
        };
        const draw = makeInstancedDraw(payload, buffer, batch.firstInstance, batch.count);
        const item: PhaseItem3d = { sourceEntity: view.sourceEntity, sortDepth: depth, draw };
        if (bucket === 'opaque') {
          phases.pushOpaque(view.sourceEntity, item);
        } else if (bucket === 'blend') {
          phases.pushTransparent(view.sourceEntity, item);
        } else {
          phases.pushAlphaMask(view.sourceEntity, item);
        }
      }
    }
  }

  /**
   * Build a {@link RenderPipelineDescriptor} for a given `SpecializeContext`,
   * threading the material's static `specialize` (when present) over the base
   * descriptor. When `ctx.key.prepass` is present, builds the prepass variant
   * (vs_prepass entrypoint, depth-only attachments for the depth-only path)
   * instead of the opaque/transparent variant.
   */
  specialize(ctx: SpecializeContext): RenderPipelineDescriptor {
    if (ctx.key.prepass !== undefined) {
      return this.specializePrepass(ctx, ctx.key.prepass);
    }
    return this.specializeOpaque(ctx);
  }

  private specializeOpaque(ctx: SpecializeContext): RenderPipelineDescriptor {
    const renderer = this.app.renderer;
    const viewLayout = (this.app.getResource(ViewBindGroupCache) as ViewBindGroupCache)
      .layout!;

    if (this.pipelineLayout === undefined) {
      const bindGroupLayouts: BindGroupLayout[] = [viewLayout, this.bindGroupLayout];
      if (this.materialClass.usesLights === true) {
        const gpuLights = this.app.getResource(GpuLights);
        if (gpuLights?.layout === undefined) {
          throw new Error(
            `MaterialPlugin<${this.materialClass.name}>: material declares usesLights but the GpuLights @group(2) layout is missing — register a Light3dPlugin before the first frame.`,
          );
        }
        bindGroupLayouts.push(gpuLights.layout);
      }
      this.pipelineLayout = renderer.createPipelineLayout({
        label: `material#${this.materialClass.name}`,
        bindGroupLayouts,
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

  /**
   * Build the prepass variant pipeline for this material. Uses the material's
   * `vs_prepass` entry point; for the depth-only path
   * (`flags.normal === false && flags.motionVector === false`) the fragment
   * stage is omitted entirely so no color attachment is required. Normal /
   * motion-vector fragment outputs are added in later steps.
   *
   * The pipeline layout reuses the opaque layout (view + material + optional
   * lights) so the same material bind group remains bound at @group(1).
   */
  private specializePrepass(
    ctx: SpecializeContext,
    flags: PrepassFlags,
  ): RenderPipelineDescriptor {
    const renderer = this.app.renderer;
    const viewLayout = (this.app.getResource(ViewBindGroupCache) as ViewBindGroupCache).layout!;

    // The prepass layout deliberately omits the lights bind group — shading
    // is not performed in the prepass, so only view + material are needed.
    if (this.prepassPipelineLayout === undefined) {
      this.prepassPipelineLayout = renderer.createPipelineLayout({
        label: `material#${this.materialClass.name}#prepass`,
        bindGroupLayouts: [viewLayout, this.bindGroupLayout],
      });
    }

    const descriptor: RenderPipelineDescriptor = {
      label: `material#${this.materialClass.name}#prepass#${flags.depth ? 'd' : ''}${flags.normal ? 'n' : ''}${flags.motionVector ? 'm' : ''}`,
      layout: this.prepassPipelineLayout,
      vertex: {
        module: this.vertexModule,
        entryPoint: 'vs_prepass',
        buffers: [ctx.layout, INSTANCE_LAYOUT],
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
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: ctx.depthBias,
      };
    }
    // When the material writes the normal channel, attach the rgba16float
    // fragment output. Motion-vector output is wired in a follow-on slice;
    // depth-only pipelines keep `fragment: undefined`. We only wire the
    // fragment stage if the material's shader actually exposes
    // `fs_prepass_normal` — that lets unlit materials (depth-only by
    // intent) participate in a depth-only prepass without inheriting a
    // fragment they cannot satisfy.
    const supportsNormalOut = this.materialSupportsPrepassNormalFragment();
    if (flags.normal && supportsNormalOut) {
      descriptor.fragment = {
        module: this.fragmentModule,
        entryPoint: 'fs_prepass_normal',
        targets: [{ format: PREPASS_NORMAL_FORMAT }],
      };
    }
    return descriptor;
  }

  private materialSupportsPrepassNormalFragment(): boolean {
    // Heuristic: materials that opt into the normal channel via their
    // `prepassWrites()` must also expose `fs_prepass_normal` in their shader.
    // The `StandardMaterial` does (pbr.wgsl); `UnlitMaterial` does not.
    // Materials default to opt-out via `prepassWrites?()` absent or returning
    // `normal: false`; the queue does not request normal-output pipelines for
    // them. So this guard primarily exists for forward-compat: a future
    // material may opt into normals without shipping the fragment yet.
    return this.materialClass.name === 'StandardMaterial';
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
