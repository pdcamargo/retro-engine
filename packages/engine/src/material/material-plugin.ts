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

import { registerAssetKind } from '../asset/asset-kinds';
import { registerAssetStore } from '../asset/asset-stores';
import { AoBindGroupCache } from '../ao/ao-bind-group-cache';
import { ViewAoTargets } from '../ao/view-ao-targets';
import { ViewBindGroupCache } from '../camera/extracted';
import { SortedCameras } from '../camera/sorted-cameras';
import type { Handle } from '@retro-engine/assets';
import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import { type FieldType, t } from '@retro-engine/reflect';

import { registerAssetSerializer } from '../asset/asset-serializers';

import type { Image } from '../image/image';
import { Images } from '../image/images';
import { RenderImages } from '../image/image-plugin';
import { GpuLights } from '../light3d/gpu-lights';
import type { App } from '../index';
import type { AllocatorSlice, MeshVertexAttribute } from '../mesh';
import { MeshAllocator, MeshAttribute, Meshes, Mesh3d, RenderMeshes } from '../mesh';
import type { PluginObject } from '../plugin';
import {
  PREPASS_FLAGS_NONE,
  intersectPrepassFlags,
  prepassFlagsAny,
  type PrepassFlags,
} from '../prepass/components';
import { PrepassFlagsByCamera } from '../prepass/prepass-plugin';
import { PreviousGlobalTransform } from '../prepass/previous-global-transform';
import {
  PREPASS_MOTION_VECTOR_FORMAT,
  PREPASS_NORMAL_FORMAT,
} from '../prepass/view-prepass-targets';
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
import { createMaterialImporter, createMaterialSerializer } from './material-importer';
import { materialReflectionSchema } from './material-reflect';
import { MATERIAL_ASSET_EXTENSION, MaterialTypes } from './material-types';
import { Materials } from './materials';
import { MeshMaterial3d } from './mesh-material-3d';
import {
  INSTANCE_LAYOUT,
  packPreviousInstanceTransform,
  PREVIOUS_INSTANCE_LAYOUT,
} from './instance-layout';
import { MeshInstanceBuffer } from './mesh-instance-buffer';
import { MeshPreviousInstanceBuffer } from './mesh-previous-instance-buffer';
import type { AlphaBucket, InstanceEntry, InstancedDrawPayload } from './instance-batching';
import { makeInstancedDraw, packInstancedBatches } from './instance-batching';
import { prepareMeshRetained, RetainedMeshBuffer } from './mesh-prepare-retained';
import type { PreparedMaterial } from './prepare-bind-group';
import { prepareBindGroup, schemaToBindGroupLayout } from './prepare-bind-group';
import { Skeleton } from '../skinning/skeleton';
import { SkinnedPaletteGpu } from '../skinning/skinned-palette-gpu';
import {
  SKINNED_INSTANCE_FLOAT_COUNT,
  SKINNED_INSTANCE_LAYOUT,
  packSkinnedInstance,
} from '../skinning/skinned-instance-layout';
import type { SkinnedDrawPayload, SkinnedInstanceEntry } from '../skinning/skinned-batching';
import {
  SkinnedInstanceBuffer,
  makeSkinnedDraw,
  packSkinnedBatches,
} from '../skinning/skinned-batching';
import { MorphWeights } from '../morph/morph-weights';
import { MorphGpu } from '../morph/morph-gpu';
import type { MorphedDrawPayload } from '../morph/morph-batching';
import { MorphInstanceBuffer, makeMorphedDraw } from '../morph/morph-batching';
import { packInstanceTransform } from './instance-layout';
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
  /**
   * Stable serialized name for this material type, independent of the
   * bundler-renamed `ctor.name` (a build can suffix it, e.g. `StandardMaterial2`).
   * Drives the `Materials<…>` store key, the `MeshMaterial3d<…>` component name,
   * the reflectable type name, and the `.remat` kind — so a saved material asset
   * round-trips across builds. Defaults to `ctor.name`; declare it on any
   * material whose assets are persisted.
   */
  readonly typeName?: string;
  readonly bindGroup: BindGroupSchema<M>;
  /**
   * When `true`, the material is lit: {@link MaterialPlugin} appends the
   * engine's `GpuLights` bind-group layout to the pipeline layout at
   * `@group(2)` so the fragment shader can read the analytic lights, and the
   * Core3d phase nodes bind it. Requires a `Light3dPlugin`. Omit (or `false`)
   * for unlit materials, whose layout stays `[view, material]`.
   */
  readonly usesLights?: boolean;
  /**
   * When `true`, the material's lit opaque variant can sample a screen-space
   * ambient-occlusion factor: {@link MaterialPlugin} appends the AO read
   * bind-group layout at `@group(3)` and compiles the `ENABLE_SSAO` shader
   * variant for cameras that have an active AO target. Requires
   * {@link usesLights} (AO modulates the ambient/indirect term, which only
   * exists in lit shading). Omit for unlit materials.
   */
  readonly usesAo?: boolean;
  vertexShader?(): ShaderRef;
  fragmentShader?(): ShaderRef;
  specialize?(
    descriptor: RenderPipelineDescriptor,
    vertexLayout: VertexBufferLayout,
    key: MaterialPipelineKey,
  ): void;
  /**
   * Extra serialized fields not derivable from {@link bindGroup} (e.g. CPU-only
   * material knobs), merged into the material's asset reflection schema. Omit if
   * the bind-group fields are the whole authored state.
   */
  readonly serializedExtras?: Readonly<Record<string, FieldType<unknown>>>;
}

/**
 * A material type's stable name for registration + serialization: its static
 * `typeName` when declared, else the class name. Used everywhere a material's
 * identity is persisted or keyed, so a bundler that renames `ctor.name` (a
 * suffix added at build time) can't break a saved `.remat`'s kind or a scene's
 * `MeshMaterial3d<…>` component name.
 */
export const materialTypeName = (ctor: {
  readonly typeName?: string;
  readonly name: string;
}): string => ctor.typeName ?? ctor.name;

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
 * - Builds the material's `BindGroupLayout` from `M.bindGroup`.
 * - Resolves vertex / fragment shaders against `ShaderRegistry` via the
 *   material's `vertexShader()` / `fragmentShader()` `ShaderRef`s.
 * - Caches a {@link SpecializedRenderPipelines}`<MaterialPipelineKey>` that
 *   varies pipeline state by `(alphaMode, hdr, msaaSamples, vertexLayout)`.
 * - Registers the per-stage systems: prepare
 *   materials (consume asset events → upload uniforms / build bind groups);
 *   queue materials (iterate visible `Mesh3d` + `MeshMaterial3d<M>` entities,
 *   push phase items into {@link ViewPhases3d}).
 *
 * Not unique — instantiate one per material type. Re-instantiating for the
 * same material type throws at `build()`.
 */
/**
 * Vertex attributes the built-in PBR / unlit vertex shaders consume — the
 * fallback for materials that don't declare {@link Material.requiredMeshAttributes}.
 */
const DEFAULT_REQUIRED_MESH_ATTRIBUTES: readonly MeshVertexAttribute[] = [
  MeshAttribute.POSITION,
  MeshAttribute.NORMAL,
  MeshAttribute.UV_0,
];

/**
 * The subset of `required` attributes not present in a mesh's provided layout
 * attribute ids. A non-empty result means a valid pipeline can't be built for
 * that mesh with the given material — the caller skips the draw. Exported for
 * tests.
 *
 * @internal
 */
export const missingMeshAttributes = (
  provided: readonly import('../mesh').MeshVertexAttributeId[],
  required: readonly MeshVertexAttribute[],
): MeshVertexAttribute[] => required.filter((attr) => !provided.includes(attr.id));

export class MaterialPlugin<M extends Material> implements PluginObject {
  readonly materialClass: MaterialCtor<M>;
  /** Per-type subclass of {@link Materials} — register / look up via this constructor. */
  readonly Materials: new () => Materials<M>;
  /** Per-type subclass of {@link RenderMaterials} — render-world prepared bind groups. */
  readonly RenderMaterials: new () => RenderMaterials<M>;
  /** Per-type subclass of {@link MeshMaterial3d} — spawn `new plugin.MeshMaterial3d(handle)`. */
  readonly MeshMaterial3d: new (handle: Handle<M>) => MeshMaterial3d<M>;
  private readonly retained: boolean;

  constructor(materialClass: MaterialCtor<M>, options?: MaterialPluginOptions) {
    this.materialClass = materialClass;
    this.retained = options?.retained ?? false;
    const name = materialTypeName(materialClass);

    const MaterialsBase = Materials as unknown as new () => Materials<M>;
    const MaterialsSubclass = class extends MaterialsBase {};
    Object.defineProperty(MaterialsSubclass, 'name', {
      value: `Materials<${name}>`,
    });
    this.Materials = MaterialsSubclass as unknown as new () => Materials<M>;

    const RenderMaterialsBase = RenderMaterials as unknown as new () => RenderMaterials<M>;
    const RenderMaterialsSubclass = class extends RenderMaterialsBase {};
    Object.defineProperty(RenderMaterialsSubclass, 'name', {
      value: `RenderMaterials<${name}>`,
    });
    this.RenderMaterials = RenderMaterialsSubclass as unknown as new () => RenderMaterials<M>;

    const MeshMaterialBase = MeshMaterial3d as unknown as new (
      h: Handle<M>,
    ) => MeshMaterial3d<M>;
    const MeshMaterialSubclass = class extends MeshMaterialBase {};
    Object.defineProperty(MeshMaterialSubclass, 'name', {
      value: `MeshMaterial3d<${name}>`,
    });
    this.MeshMaterial3d = MeshMaterialSubclass as unknown as new (
      h: Handle<M>,
    ) => MeshMaterial3d<M>;
  }

  name(): string {
    return `MaterialPlugin<${this.materialClass.name}>`;
  }

  category(): 'engine' {
    return 'engine';
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
    const materials = new this.Materials();
    app.insertResource(materials);
    app.insertResource(new this.RenderMaterials());
    if (app.getResource(ViewPhases3d) === undefined) {
      app.insertResource(new ViewPhases3d());
    }

    // The handle's asset type is qualified by the material's stable name so two
    // material types never resolve to each other's store; it backs both the
    // `t.handle` schema and the store registration, the single source of truth
    // for this material's GUID resolution. Stable (not `ctor.name`) so a saved
    // scene / `.remat` resolves across builds that rename the class.
    const name = materialTypeName(this.materialClass);
    const materialsKey = `Materials<${name}>`;
    registerAssetStore(app, materialsKey, materials);

    // Register the synthesised per-type subclass — not the base — so the scene
    // serializer recognises the exact constructor entities carry. The name is
    // qualified by the material type so two material types never collide. The
    // handle is the only authored state; make supplies a placeholder decode
    // overwrites.
    app.registerComponent(
      this.MeshMaterial3d,
      { handle: t.handle<M>(materialsKey) },
      {
        name: `MeshMaterial3d<${name}>`,
        make: () => new this.MeshMaterial3d(makeHandle(asAssetIndex(0))),
      },
    );

    // Material-as-asset: register the material VALUE type as reflectable
    // (distinct from the MeshMaterial3d component above) with a schema derived
    // from its bind group, plus its `.remat` serializer and a MaterialTypes
    // descriptor. The kind-keyed loader is wired separately by
    // `registerMaterialLoaders` once an AssetServer exists — it may not at build
    // time (AssetPlugin is added by the host, often later).
    const reflect = app.registerType(
      this.materialClass as unknown as ComponentType<M>,
      materialReflectionSchema(this.materialClass),
      { name, make: () => new this.materialClass() },
    );
    const serializer = createMaterialSerializer<M>(app, this.materialClass as unknown as ComponentType<object>);
    registerAssetSerializer(app, name, serializer);
    let materialTypes = app.getResource(MaterialTypes);
    if (materialTypes === undefined) {
      materialTypes = new MaterialTypes();
      app.insertResource(materialTypes);
    }
    materialTypes.register({
      kind: name,
      store: materials as unknown as Materials<Material>,
      reflect,
      importer: createMaterialImporter<M>(app, this.materialClass as unknown as ComponentType<object>) as never,
      serializer: serializer as never,
      makeDefault: () => reflect.make(),
    });

    // Catalogue this material type as an asset kind so the browser maps its kind
    // (the class name) to the `material` category. Material kinds share `.remat`
    // and are never discovered loose — a `.remat` is always saved with a sidecar.
    registerAssetKind(app, {
      kind: name,
      extensions: [MATERIAL_ASSET_EXTENSION],
      discoverable: false,
      category: 'material',
    });

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

    type MmCtor = new (h: Handle<M>) => MeshMaterial3d<M>;

    // Skinned draws are a separate pipeline variant with their own per-instance
    // layout and joint palette, so they cannot share the rigid batch — they get
    // their own queue, keyed on the presence of a Skeleton. Registered for both
    // the retained and non-retained rigid paths.
    type SkinnedRenderablesQuery = QueryHandle<
      readonly [typeof Mesh3d, MmCtor, typeof GlobalTransform, typeof ViewVisibility, typeof Skeleton]
    >;
    app.addSystem(
      'render',
      [
        Extract(Query([Mesh3d, MeshMaterialCtor, GlobalTransform, ViewVisibility, Skeleton])),
        Res(SortedCameras),
        Res(RenderMaterialsCtor),
        Res(RenderMeshes),
        Res(MeshAllocator),
        ResMut(ViewPhases3d),
        Res(ViewBindGroupCache),
      ],
      (skinned, cameras, renderMaterials, renderMeshes, allocator, phases, viewBindGroupCache) => {
        state.ensureInitialised(app);
        state.queueSkinnedMaterials(
          app,
          skinned as unknown as SkinnedRenderablesQuery,
          cameras as unknown as SortedCameras,
          renderMaterials as unknown as RenderMaterials<M>,
          renderMeshes as unknown as RenderMeshes,
          allocator as unknown as MeshAllocator,
          phases,
          viewBindGroupCache as unknown as ViewBindGroupCache,
        );
      },
      { set: RenderSet.Queue, name: 'material-queue-skinned' },
    );

    // Morphed draws are their own pipeline variant (blend-shape deltas at
    // @group(3)) emitted one instance per entity, keyed on a MorphWeights
    // component. Registered for both rigid paths, like the skinned queue.
    type MorphedRenderablesQuery = QueryHandle<
      readonly [
        typeof Mesh3d,
        MmCtor,
        typeof GlobalTransform,
        typeof ViewVisibility,
        typeof MorphWeights,
      ]
    >;
    app.addSystem(
      'render',
      [
        Extract(
          Query([Mesh3d, MeshMaterialCtor, GlobalTransform, ViewVisibility, MorphWeights], {
            without: [Skeleton],
          }),
        ),
        Res(SortedCameras),
        Res(RenderMaterialsCtor),
        Res(Meshes),
        Res(RenderMeshes),
        Res(MeshAllocator),
        ResMut(ViewPhases3d),
        Res(ViewBindGroupCache),
      ],
      (morphed, cameras, renderMaterials, meshes, renderMeshes, allocator, phases, viewBindGroupCache) => {
        state.ensureInitialised(app);
        state.queueMorphedMaterials(
          app,
          morphed as unknown as MorphedRenderablesQuery,
          cameras as unknown as SortedCameras,
          renderMaterials as unknown as RenderMaterials<M>,
          meshes as unknown as Meshes,
          renderMeshes as unknown as RenderMeshes,
          allocator as unknown as MeshAllocator,
          phases,
          viewBindGroupCache as unknown as ViewBindGroupCache,
        );
      },
      { set: RenderSet.Queue, name: 'material-queue-morphed' },
    );

    // Morphed entities draw through the morphed queue when storage buffers back
    // the morph path; on a backend without it they fall through to the rigid
    // queue and draw from base geometry. Skinned entities always draw through
    // the skinned queue.
    const rigidWithout = app.renderer.capabilities.storageBuffers
      ? [Skeleton, MorphWeights]
      : [Skeleton];

    if (this.retained) {
      this.registerRetained(app, state, MeshMaterialCtor, RenderMaterialsCtor);
      return;
    }

    // Queue: iterate visible (Mesh3d, MeshMaterial3d<M>, GlobalTransform,
    // ViewVisibility) entities × active cameras; batch by (mesh, material);
    // pack per-instance transforms; specialize the pipeline; push one phase
    // item per instanced batch. Skinned entities are excluded — they draw
    // through the skinned queue above.
    type RenderablesQuery = QueryHandle<
      readonly [typeof Mesh3d, MmCtor, typeof GlobalTransform, typeof ViewVisibility]
    >;
    app.addSystem(
      'render',
      [
        Extract(Query([Mesh3d, MeshMaterialCtor, GlobalTransform, ViewVisibility], { without: rigidWithout })),
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
      { set: RenderSet.Queue, name: 'material-queue' },
    );
  }

  /**
   * Register the retained, change-gated instance prepare + a thin queue that
   * emits phase items from the per-camera ordered buffers.
   */
  private registerRetained(
    app: App,
    state: MaterialPluginState<M>,
    MeshMaterialCtor: new (h: Handle<M>) => MeshMaterial3d<M>,
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
      { set: RenderSet.Queue, name: 'material-instance-queue' },
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

// Keyed on a stable boolean (never a class name) so the AO and non-AO pipeline
// variants stay distinct in the cache and survive bundler minification.
const aoKeyPart = (aoEnabled: boolean | undefined): string => (aoEnabled === true ? 'ao=1' : 'ao=0');

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
  /**
   * Vertex/fragment shader module variant compiled with the
   * `PREPASS_MOTION_VECTOR` define active. Lazily built the first time a
   * motion-vector prepass pipeline is requested for this material — the
   * variant declares the previous-instance vertex attributes at
   * `@location(4..7)` and the `fs_prepass_motion` /
   * `fs_prepass_normal_motion` fragment entries. Materials without motion
   * support never trigger the compile.
   */
  motionVertexModule: ShaderModule | undefined;
  motionFragmentModule: ShaderModule | undefined;
  vertexShaderRef!: ShaderRef;
  fragmentShaderRef!: ShaderRef;
  vertexEntryPoint = 'vs_main';
  fragmentEntryPoint = 'fs_main';
  pipelineLayout: PipelineLayout | undefined;
  prepassPipelineLayout: PipelineLayout | undefined;
  /**
   * Pipeline layout for the AO-enabled lit variant: the opaque layout plus the
   * screen-space AO read bind group at `@group(3)`. Built lazily the first time
   * an `aoEnabled` pipeline is requested.
   */
  aoPipelineLayout: PipelineLayout | undefined;
  /**
   * Fragment module compiled with `ENABLE_SSAO` active — `fs_main` samples the
   * `@group(3)` AO texture and folds it into the ambient term. Lazily built on
   * the first `aoEnabled` request; materials that never enable AO never compile
   * it.
   */
  aoFragmentModule: ShaderModule | undefined;
  /**
   * Vertex module variant compiled with the `SKINNED` define — declares the
   * per-vertex joint index/weight and per-instance `joint_offset` inputs and the
   * `@group(3)` joint-palette storage buffer. Lazily built the first time a
   * skinned pipeline is requested for this material.
   */
  skinnedVertexModule: ShaderModule | undefined;
  /** Pipeline layout for the skinned variant: view / material / lights / palette(3). */
  skinnedPipelineLayout: PipelineLayout | undefined;
  /** Vertex module compiled with `MORPHED` — reads blend-shape deltas at `@group(3)`. */
  morphedVertexModule: ShaderModule | undefined;
  /** Pipeline layout for the morphed variant: view / material / lights / morph(3). */
  morphedPipelineLayout: PipelineLayout | undefined;
  /** Vertex module compiled with `SKINNED` + `MORPHED` — palette + morph at `@group(3)`. */
  skinnedMorphedVertexModule: ShaderModule | undefined;
  /** Pipeline layout for the skinned+morphed variant: view / material / lights / palette+morph(3). */
  skinnedMorphedPipelineLayout: PipelineLayout | undefined;
  specialized!: SpecializedRenderPipelines<SpecializeContext>;
  readonly instanceBuffer = new MeshInstanceBuffer();
  /** Sibling of {@link instanceBuffer} for skinned draws (wider stride + `joint_offset`). */
  readonly skinnedInstanceBuffer = new SkinnedInstanceBuffer();
  /** Sibling of {@link instanceBuffer} for morphed draws (one instance per morphed entity). */
  readonly morphInstanceBuffer = new MorphInstanceBuffer();
  /**
   * Sibling of {@link instanceBuffer} carrying each entity's previous-frame
   * model matrix for motion-vector prepass reconstruction. Allocated lazily on
   * the first frame at least one active camera has `MotionVectorPrepass`
   * active and at least one opt-in material participates.
   */
  readonly previousInstanceBuffer = new MeshPreviousInstanceBuffer();
  readonly retainedBuffer = new RetainedMeshBuffer<M>(MaterialPluginState.depthOrderedBuckets);
  scratch = new ArrayBuffer(1024);
  /**
   * Materials whose textures haven't all uploaded yet, by handle index → handle.
   * They prepared against the default image; re-prepared each frame until their
   * referenced images land (async decode + GPU upload), then dropped.
   */
  private readonly pendingTextureMaterials = new Map<number, Handle<M>>();
  /** Mesh handle indices already warned about for a missing required attribute (warn once). */
  private readonly warnedMissingMeshAttrs = new Set<number>();
  app!: App;
  initialised = false;
  /**
   * The prepass channels this material class can actually write, captured
   * from a representative instance's {@link Material.prepassWrites} once at
   * init. Drives prepass fragment-target selection (a material that declares
   * a channel here ships the matching `fs_prepass_*` entry). Derived from the
   * material's own declaration rather than its class identity so it survives
   * bundler minification of class names.
   */
  prepassCapabilities: PrepassFlags = PREPASS_FLAGS_NONE;

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

    // Capture which prepass channels this material can write from a
    // representative instance. `prepassWrites()` is a class-level declaration
    // (instances do not vary it), so any instance answers for the class. A
    // material with required constructor arguments — or none declaring
    // prepass support — leaves the default (no channels).
    try {
      const probe = new this.materialClass();
      this.prepassCapabilities = probe.prepassWrites?.() ?? PREPASS_FLAGS_NONE;
    } catch {
      this.prepassCapabilities = PREPASS_FLAGS_NONE;
    }

    const vertexRef = this.materialClass.vertexShader?.() ?? ({ kind: 'default' } as const);
    const fragmentRef = this.materialClass.fragmentShader?.() ?? ({ kind: 'default' } as const);
    this.vertexShaderRef = vertexRef;
    this.fragmentShaderRef = fragmentRef;
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
        `${alphaModeKey(ctx.key.alphaMode)}|hdr=${ctx.key.hdr}|msaa=${ctx.key.msaaSamples}|vl=${ctx.key.vertexLayoutDigest}|cf=${ctx.colorFormat}|df=${ctx.depthFormat ?? 'none'}|db=${ctx.depthBias}|${prepassKeyPart(ctx.key.prepass)}|${prepassReadableKeyPart(ctx.key.prepassReadable)}|${aoKeyPart(ctx.key.aoEnabled)}|ds=${ctx.key.doubleSided === true}|sk=${ctx.key.skinned === true}|mo=${ctx.key.morphed === true}`,
    );
  }

  prepareMaterials(
    app: App,
    materials: Materials<M>,
    renderMaterials: RenderMaterials<M>,
    images: Images,
    renderImages: RenderImages,
  ): void {
    const events = materials.drainEvents();
    const pending = this.pendingTextureMaterials;
    if (events.length === 0 && pending.size === 0) return;

    // (Re)prepare changed/added materials plus any still waiting on a texture.
    const toPrepare = new Map<number, Handle<M>>();
    for (const event of events) {
      if (event.kind === 'unused') continue;
      if (event.kind === 'removed') {
        renderMaterials.delete(event.handle);
        pending.delete(event.handle.index);
        continue;
      }
      toPrepare.set(event.handle.index, event.handle);
    }
    for (const [index, handle] of pending) if (!toPrepare.has(index)) toPrepare.set(index, handle);

    for (const [index, handle] of toPrepare) {
      const value = materials.get(handle);
      if (value === undefined) {
        pending.delete(index);
        continue;
      }
      const previous = renderMaterials.get(handle);
      let prepared;
      try {
        prepared = prepareBindGroup(
          app.renderer,
          this.materialClass.bindGroup,
          this.bindGroupLayout,
          value as M,
          previous,
          this.scratch,
          images,
          renderImages,
          `material#${this.materialClass.name}#${index}`,
        );
      } catch (error) {
        // A malformed material value (e.g. a wrong-shaped uniform field) must not
        // abort the whole prepare pass and freeze the frame loop — skip this one,
        // warn once, and leave the rest of the scene rendering. It re-prepares if
        // the material is edited again (a fresh event).
        app.logger.devWarn(
          `MaterialPlugin.prepareMaterials: skipping material #${index} (${this.materialClass.name}) — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        pending.delete(index);
        continue;
      }
      renderMaterials.set(handle, prepared);
      // A texture handle not yet in RenderImages prepared against the default
      // image; keep re-preparing until it lands, then drop from the pending set.
      if (this.hasPendingTextures(value as M, renderImages)) pending.set(index, handle);
      else pending.delete(index);
    }
  }

  /** True if any of `material`'s texture-handle fields references an image not yet uploaded. */
  private hasPendingTextures(material: M, renderImages: RenderImages): boolean {
    for (const entry of this.materialClass.bindGroup) {
      if (entry.kind !== 'texture' || entry.imageMode !== 'handle') continue;
      const handle = (material as Record<string, unknown>)[entry.fieldKey] as Handle<Image> | undefined;
      if (handle !== undefined && handle !== null && renderImages.get(handle) === undefined) return true;
    }
    return false;
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

    // Detect whether any active prepass camera has motion-vector enabled —
    // if not, the previous-instance buffer is neither allocated nor packed,
    // and InstanceEntry.previousModel stays undefined.
    let motionActive = false;
    if (prepassFlagsByCamera !== undefined) {
      for (const f of prepassFlagsByCamera.map.values()) {
        if (f.motionVector) {
          motionActive = true;
          break;
        }
      }
    }

    // Collect one entry per (visible entity × view), then batch by
    // (mesh, material). Pipeline / material bind group / mesh slices are
    // constant across a group, so the batch carries them once.
    const aoTargets = app.getResource(ViewAoTargets);
    const entries: InstanceEntry[] = [];
    for (const view of cameras.views) {
      const cameraEntity = view.sourceEntity;
      const colorFormat = view.mainColorTarget.format;
      const depthFormat = view.depth?.format;
      const aoActiveForView =
        this.materialClass.usesAo === true &&
        aoTargets?.perCamera.has(view.sourceEntity as Entity) === true;
      const v = view.viewMatrix as Float32Array;
      for (const row of renderables.entries()) {
        const entity = row[0] as Entity;
        const mesh3d = row[1] as Mesh3d;
        const meshMat = row[2] as MeshMaterial3d<M>;
        const gt = row[3] as GlobalTransform;
        const vis = row[4] as ViewVisibility;
        if (!vis.visible) continue;

        const renderMesh = renderMeshes.get(mesh3d.handle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(mesh3d.handle.index);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(mesh3d.handle.index);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(meshMat.handle);
        if (prepared === undefined) continue;

        const materialInstance = mainWorldMaterials?.get(meshMat.handle);

        // Guard against a mesh that lacks a vertex attribute the material's shader
        // requires: building a pipeline for it fails device validation, and the
        // invalid pipeline poisons the whole frame's encoder (freezing the
        // viewport). Skip this mesh's draw and warn once instead.
        const required = materialInstance?.requiredMeshAttributes?.() ?? DEFAULT_REQUIRED_MESH_ATTRIBUTES;
        const missingAttrs = missingMeshAttributes(renderMesh.layout.attributeIds, required);
        if (missingAttrs.length > 0) {
          if (!this.warnedMissingMeshAttrs.has(mesh3d.handle.index)) {
            this.warnedMissingMeshAttrs.add(mesh3d.handle.index);
            app.logger.devWarn(
              `MaterialPlugin: mesh #${mesh3d.handle.index} is missing vertex attribute(s) [${missingAttrs
                .map((a) => a.name)
                .join(', ')}] required by ${this.materialClass.name}; skipping its draw (a valid pipeline can't be built).`,
            );
          }
          continue;
        }

        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;
        const doubleSided = materialInstance?.doubleSided?.() ?? false;

        const layout = renderMesh.layout.layout;
        // AO modulates the lit ambient term in the opaque pass (opaque +
        // alpha-mask draw there); blend draws in the transparent pass, which
        // does not bind @group(3), so it never takes the AO variant.
        const aoEnabled = aoActiveForView && alphaMode !== 'blend';
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: view.hdr,
          vertexLayoutDigest: vertexLayoutDigestFor(layout),
          alphaMode,
          ...(aoEnabled ? { aoEnabled: true } : {}),
          ...(doubleSided ? { doubleSided: true } : {}),
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
        // Read the previous-frame world matrix only when motion is active.
        // Falls back to the current matrix when the component is absent —
        // the Mesh3d insert hook installed by PrepassPlugin auto-attaches it
        // for every 3D renderable, so the absent case is unreachable in
        // practice; the fallback exists to keep the previous-instance buffer
        // in lockstep with the current one (skipping would break indexing).
        let previousModel: Mat4 | undefined;
        if (motionActive) {
          const prevGt = app.world.getComponent(entity, PreviousGlobalTransform);
          previousModel = (prevGt?.matrix ?? gt.matrix) as Mat4;
        }
        const entry: InstanceEntry = {
          cameraEntity,
          bucket,
          groupKey: `${mesh3d.handle.index}/${meshMat.handle.index}`,
          materialHandle: meshMat.handle,
          depth: sortDepth,
          model: gt.matrix as Mat4,
          payload: { pipeline, materialBindGroup: prepared.bindGroup, vertexSlice, indexSlice, renderMesh },
          ...(previousModel !== undefined ? { previousModel } : {}),
        };
        entries.push(entry);
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

    // Pack the previous-instance buffer in lockstep with `entries`'s now-
    // sorted order so `firstInstance + count` indexes both buffers identically
    // for any motion-vector prepass batch.
    let previousInstanceGpuBuffer: import('@retro-engine/renderer-core').Buffer | undefined;
    if (motionActive) {
      this.previousInstanceBuffer.ensureCapacity(app.renderer, entries.length);
      let prevCursor = 0;
      for (const e of entries) {
        prevCursor += packPreviousInstanceTransform(
          this.previousInstanceBuffer.scratchF32,
          prevCursor,
          (e.previousModel ?? e.model) as Mat4,
        );
      }
      this.previousInstanceBuffer.count = entries.length;
      previousInstanceGpuBuffer = this.previousInstanceBuffer.buffer!;
      if (prevCursor > 0) {
        app.renderer.writeBuffer(
          previousInstanceGpuBuffer,
          0,
          this.previousInstanceBuffer.scratchF32.subarray(0, prevCursor) as unknown as BufferSource,
        );
      }
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
    // `phases.prepass` using a depth-only (or depth + normal /
    // motion-vector) pipeline variant. The instance buffer is **reused** —
    // both the opaque and prepass batches index into the same packed
    // transforms, so we pay zero extra upload for the prepass.
    if (prepassFlagsByCamera === undefined || prepassFlagsByCamera.map.size === 0) return;
    this.queuePrepassFromEntries(
      app,
      entries,
      cameras,
      mainWorldMaterials,
      phases,
      prepassFlagsByCamera,
      buffer,
      previousInstanceGpuBuffer,
    );
  }

  /**
   * Queue skinned (Skeleton-bearing) renderables. Mirrors {@link queueMaterials}
   * but routes each instance to the skinned pipeline variant, packs the wider
   * skinned instance (model + inverse-transpose + `joint_offset`), and binds the
   * shared joint palette at `@group(3)`. No-op without storage-buffer support or
   * before the palette has been uploaded this frame. AO / prepass are skipped
   * for skinned draws (ADR-0114/0115).
   */
  queueSkinnedMaterials(
    app: App,
    renderables: QueryHandle<
      readonly [
        typeof Mesh3d,
        new (...a: never[]) => MeshMaterial3d<M>,
        typeof GlobalTransform,
        typeof ViewVisibility,
        typeof Skeleton,
      ]
    >,
    cameras: SortedCameras,
    renderMaterials: RenderMaterials<M>,
    renderMeshes: RenderMeshes,
    allocator: MeshAllocator,
    phases: ViewPhases3d,
    viewBindGroupCache: ViewBindGroupCache,
  ): void {
    if (viewBindGroupCache.layout === undefined) return;
    if (cameras.views.length === 0) return;
    if (!app.renderer.capabilities.storageBuffers) return;
    const paletteGpu = app.getResource(SkinnedPaletteGpu);
    if (paletteGpu?.bindGroup === undefined) return;
    const paletteBindGroup = paletteGpu.bindGroup;

    const mainWorldMaterials = app.getResource(this.plugin.Materials) as Materials<M> | undefined;
    const aoCache = app.getResource(AoBindGroupCache);
    // A skinned mesh that also carries morph targets draws through the combined
    // (skinned + morphed) variant: @group(3) binds palette + morph data together,
    // and it cannot share an instanced batch (per-entity bind group), so combined
    // entries are emitted one draw each.
    const meshes = app.getResource(Meshes);
    const morphGpu = app.getResource(MorphGpu);
    const paletteBuffer = paletteGpu.buffer;
    const entries: SkinnedInstanceEntry[] = [];
    const combined: SkinnedInstanceEntry[] = [];

    for (const view of cameras.views) {
      const cameraEntity = view.sourceEntity;
      const colorFormat = view.mainColorTarget.format;
      const depthFormat = view.depth?.format;
      // SSAO shares @group(3) with the palette; if this view bound one, the
      // skinned draw restores it afterward so rigid AO draws keep working.
      const restoreGroup3 = aoCache?.get(view.sourceEntity as Entity);
      const v = view.viewMatrix as Float32Array;
      for (const row of renderables.entries()) {
        const entity = row[0] as Entity;
        const mesh3d = row[1] as Mesh3d;
        const meshMat = row[2] as MeshMaterial3d<M>;
        const gt = row[3] as GlobalTransform;
        const vis = row[4] as ViewVisibility;
        if (!vis.visible) continue;

        const jointOffset = paletteGpu.offsets.get(entity);
        if (jointOffset === undefined) continue;

        const renderMesh = renderMeshes.get(mesh3d.handle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(mesh3d.handle.index);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(mesh3d.handle.index);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(meshMat.handle);
        if (prepared === undefined) continue;

        const materialInstance = mainWorldMaterials?.get(meshMat.handle);
        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;
        const doubleSided = materialInstance?.doubleSided?.() ?? false;

        const mesh = meshes?.get(mesh3d.handle);
        const morphWeights =
          morphGpu !== undefined && mesh?.morphTargets !== undefined && paletteBuffer !== undefined
            ? app.world.getComponent(entity, MorphWeights)
            : undefined;

        const layout = renderMesh.layout.layout;
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: view.hdr,
          vertexLayoutDigest: vertexLayoutDigestFor(layout),
          alphaMode,
          skinned: true,
          ...(morphWeights !== undefined ? { morphed: true } : {}),
          ...(doubleSided ? { doubleSided: true } : {}),
        };
        const pipeline = this.specialized.get({ key, colorFormat, depthFormat, depthBias, layout });

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

        // Combined skinned + morphed: bind the per-entity palette+morph group(3)
        // (built by MorphGpu over the shared palette buffer) at the palette slot.
        const group3 =
          morphWeights !== undefined
            ? morphGpu!.prepareEntity(
                app.renderer,
                entity,
                morphGpu!.ensureDeltas(app.renderer, mesh3d.handle.index, mesh!.morphTargets!),
                mesh3d.handle.index,
                morphWeights.weights,
                vertexSlice.baseVertex,
                paletteBuffer,
              )
            : paletteBindGroup;

        const payload: SkinnedDrawPayload = {
          pipeline,
          materialBindGroup: prepared.bindGroup,
          paletteBindGroup: group3,
          vertexSlice,
          indexSlice,
          renderMesh,
          ...(restoreGroup3 !== undefined ? { restoreGroup3 } : {}),
        };
        (morphWeights !== undefined ? combined : entries).push({
          cameraEntity,
          bucket,
          groupKey: `${mesh3d.handle.index}/${meshMat.handle.index}`,
          depth: sortDepth,
          model: gt.matrix as Mat4,
          jointOffset,
          payload,
        });
      }
    }
    if (entries.length === 0 && combined.length === 0) return;

    this.skinnedInstanceBuffer.ensureCapacity(app.renderer, entries.length + combined.length);
    const f32 = this.skinnedInstanceBuffer.f32;
    const u32 = this.skinnedInstanceBuffer.u32;
    const { batches, cursorSlots } = packSkinnedBatches(
      entries,
      MaterialPluginState.depthOrderedBuckets,
      f32,
      u32,
    );
    // Pack each combined entry as its own instance after the batched region; it
    // draws alone (count 1) because its @group(3) bind group is per-entity.
    let cursor = cursorSlots;
    const combinedDraws: { entry: SkinnedInstanceEntry; firstInstance: number }[] = [];
    for (const entry of combined) {
      const firstInstance = cursor / SKINNED_INSTANCE_FLOAT_COUNT;
      cursor += packSkinnedInstance(f32, u32, cursor, entry.model, entry.jointOffset);
      combinedDraws.push({ entry, firstInstance });
    }
    this.skinnedInstanceBuffer.count = entries.length + combined.length;
    const buffer = this.skinnedInstanceBuffer.buffer!;
    if (cursor > 0) {
      app.renderer.writeBuffer(buffer, 0, f32.subarray(0, cursor) as unknown as BufferSource);
    }

    const push = (cameraEntity: number, bucket: AlphaBucket, item: PhaseItem3d): void => {
      if (bucket === 'opaque') phases.pushOpaque(cameraEntity, item);
      else if (bucket === 'blend') phases.pushTransparent(cameraEntity, item);
      else phases.pushAlphaMask(cameraEntity, item);
    };

    for (const batch of batches) {
      const draw = makeSkinnedDraw(batch.payload, buffer, batch.firstInstance, batch.count);
      push(batch.cameraEntity, batch.bucket, {
        sourceEntity: batch.cameraEntity,
        sortDepth: batch.sortDepth,
        draw,
      });
    }
    for (const { entry, firstInstance } of combinedDraws) {
      const draw = makeSkinnedDraw(entry.payload, buffer, firstInstance, 1);
      push(entry.cameraEntity, entry.bucket, {
        sourceEntity: entry.cameraEntity,
        sortDepth: entry.depth,
        draw,
      });
    }
  }

  /**
   * Queue morphed (MorphWeights-bearing) renderables. Each is its own draw — a
   * single instance with the morphed pipeline variant, binding the entity's
   * blend-shape deltas + weights + params at `@group(3)`. No-op without storage
   * buffers. AO / prepass are skipped for morphed draws (ADR-0129); a borrowed
   * SSAO group(3) is restored after each draw.
   */
  queueMorphedMaterials(
    app: App,
    renderables: QueryHandle<
      readonly [
        typeof Mesh3d,
        new (...a: never[]) => MeshMaterial3d<M>,
        typeof GlobalTransform,
        typeof ViewVisibility,
        typeof MorphWeights,
      ]
    >,
    cameras: SortedCameras,
    renderMaterials: RenderMaterials<M>,
    meshes: Meshes,
    renderMeshes: RenderMeshes,
    allocator: MeshAllocator,
    phases: ViewPhases3d,
    viewBindGroupCache: ViewBindGroupCache,
  ): void {
    if (viewBindGroupCache.layout === undefined) return;
    if (cameras.views.length === 0) return;
    if (!app.renderer.capabilities.storageBuffers) return;
    const morphGpu = app.getResource(MorphGpu);
    if (morphGpu === undefined) return;

    const renderer = app.renderer;
    const mainWorldMaterials = app.getResource(this.plugin.Materials) as Materials<M> | undefined;
    const aoCache = app.getResource(AoBindGroupCache);

    interface PendingMorphedDraw {
      readonly cameraEntity: number;
      readonly bucket: AlphaBucket;
      readonly sortDepth: number;
      readonly model: Mat4;
      readonly payload: MorphedDrawPayload;
    }
    const pending: PendingMorphedDraw[] = [];

    for (const view of cameras.views) {
      const cameraEntity = view.sourceEntity;
      const colorFormat = view.mainColorTarget.format;
      const depthFormat = view.depth?.format;
      const restoreGroup3 = aoCache?.get(view.sourceEntity as Entity);
      const v = view.viewMatrix as Float32Array;
      for (const row of renderables.entries()) {
        const entity = row[0] as Entity;
        const mesh3d = row[1] as Mesh3d;
        const meshMat = row[2] as MeshMaterial3d<M>;
        const gt = row[3] as GlobalTransform;
        const vis = row[4] as ViewVisibility;
        const morphWeights = row[5] as MorphWeights;
        if (!vis.visible) continue;

        const mesh = meshes.get(mesh3d.handle);
        if (mesh?.morphTargets === undefined) continue;
        const renderMesh = renderMeshes.get(mesh3d.handle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(mesh3d.handle.index);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(mesh3d.handle.index);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(meshMat.handle);
        if (prepared === undefined) continue;

        const delta = morphGpu.ensureDeltas(renderer, mesh3d.handle.index, mesh.morphTargets);
        const morphBindGroup = morphGpu.prepareEntity(
          renderer,
          entity,
          delta,
          mesh3d.handle.index,
          morphWeights.weights,
          vertexSlice.baseVertex,
        );

        const materialInstance = mainWorldMaterials?.get(meshMat.handle);

        // Guard against a mesh that lacks a vertex attribute the material's shader
        // requires: building a pipeline for it fails device validation, and the
        // invalid pipeline poisons the whole frame's encoder (freezing the
        // viewport). Skip this mesh's draw and warn once instead.
        const required = materialInstance?.requiredMeshAttributes?.() ?? DEFAULT_REQUIRED_MESH_ATTRIBUTES;
        const missingAttrs = missingMeshAttributes(renderMesh.layout.attributeIds, required);
        if (missingAttrs.length > 0) {
          if (!this.warnedMissingMeshAttrs.has(mesh3d.handle.index)) {
            this.warnedMissingMeshAttrs.add(mesh3d.handle.index);
            app.logger.devWarn(
              `MaterialPlugin: mesh #${mesh3d.handle.index} is missing vertex attribute(s) [${missingAttrs
                .map((a) => a.name)
                .join(', ')}] required by ${this.materialClass.name}; skipping its draw (a valid pipeline can't be built).`,
            );
          }
          continue;
        }

        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;
        const doubleSided = materialInstance?.doubleSided?.() ?? false;

        const layout = renderMesh.layout.layout;
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: view.hdr,
          vertexLayoutDigest: vertexLayoutDigestFor(layout),
          alphaMode,
          morphed: true,
          ...(doubleSided ? { doubleSided: true } : {}),
        };
        const pipeline = this.specialized.get({ key, colorFormat, depthFormat, depthBias, layout });

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
        const payload: MorphedDrawPayload = {
          pipeline,
          materialBindGroup: prepared.bindGroup,
          morphBindGroup,
          vertexSlice,
          indexSlice,
          renderMesh,
          ...(restoreGroup3 !== undefined ? { restoreGroup3 } : {}),
        };
        pending.push({ cameraEntity, bucket, sortDepth, model: gt.matrix as Mat4, payload });
      }
    }

    if (pending.length === 0) return;

    this.morphInstanceBuffer.ensureCapacity(renderer, pending.length);
    const f32 = this.morphInstanceBuffer.f32;
    let cursor = 0;
    for (const p of pending) cursor += packInstanceTransform(f32, cursor, p.model);
    const buffer = this.morphInstanceBuffer.buffer!;
    renderer.writeBuffer(buffer, 0, f32.subarray(0, cursor) as unknown as BufferSource);

    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      const draw = makeMorphedDraw(p.payload, buffer, i);
      const item: PhaseItem3d = { sourceEntity: p.cameraEntity, sortDepth: p.sortDepth, draw };
      if (p.bucket === 'opaque') {
        phases.pushOpaque(p.cameraEntity, item);
      } else if (p.bucket === 'blend') {
        phases.pushTransparent(p.cameraEntity, item);
      } else {
        phases.pushAlphaMask(p.cameraEntity, item);
      }
    }
  }

  private queuePrepassFromEntries(
    _app: App,
    entries: readonly InstanceEntry[],
    cameras: SortedCameras,
    mainWorldMaterials: Materials<M> | undefined,
    phases: ViewPhases3d,
    prepassFlagsByCamera: PrepassFlagsByCamera,
    instanceBuffer: import('@retro-engine/renderer-core').Buffer,
    previousInstanceBuffer: import('@retro-engine/renderer-core').Buffer | undefined,
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
      const materialInstance = mainWorldMaterials?.get(entry.materialHandle as Handle<M>);
      const matFlags = materialInstance?.prepassWrites?.();
      if (matFlags === undefined) continue;
      // Only opaque geometry contributes to the screen-space prepass. The
      // prepass rasterises whole primitives, so an alpha-tested or blended
      // material would write depth (and normals / motion vectors) for texels
      // its forward pass later discards — and the prepass cannot reproduce the
      // forward pass's exact per-fragment coverage, so any such texel leaves
      // depth with no shaded colour, punching a clear-coloured hole through
      // everything behind it. Alpha-masked / transparent materials establish
      // their own depth in the forward pass instead.
      if ((materialInstance?.alphaMode?.() ?? 'opaque') !== 'opaque') continue;
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
      const doubleSided = materialInstance?.doubleSided?.() ?? false;
      const key: MaterialPipelineKey = {
        msaaSamples: 1,
        hdr: view.hdr,
        vertexLayoutDigest: vertexLayoutDigestFor(layout),
        alphaMode: 'opaque',
        prepass: flags,
        ...(doubleSided ? { doubleSided: true } : {}),
      };
      const depthBias = materialInstance?.depthBias?.() ?? 0;
      const pipeline = this.specialized.get({ key, colorFormat, depthFormat, depthBias, layout });
      // Wire the previous-instance buffer onto this payload only when the
      // pipeline variant actually consumes it (motion-vector channel). Other
      // prepass variants leave slot 2 unbound — `makeInstancedDraw` skips
      // the `setVertexBuffer(2, …)` call when the field is undefined.
      const payloadPrevBuf = flags.motionVector ? previousInstanceBuffer : undefined;
      const payload: InstancedDrawPayload = {
        pipeline,
        materialBindGroup: entry.payload.materialBindGroup,
        vertexSlice: entry.payload.vertexSlice,
        indexSlice: entry.payload.indexSlice,
        renderMesh: entry.payload.renderMesh,
        ...(payloadPrevBuf !== undefined ? { previousInstanceBuffer: payloadPrevBuf } : {}),
      };
      prepassEntries.push({
        cameraEntity: entry.cameraEntity,
        bucket: 'opaque',
        groupKey: entry.groupKey,
        materialHandle: entry.materialHandle,
        depth: entry.depth,
        model: entry.model,
        payload,
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
    const aoTargets = app.getResource(ViewAoTargets);

    for (const view of cameras.views) {
      if (view.subGraph !== Core3dLabel) continue;
      const index = this.retainedBuffer.indexByCamera.get(view.sourceEntity as Entity);
      if (index === undefined) continue;
      const buffer = index.ordered.buffer;
      if (buffer === undefined) continue;
      const colorFormat = view.mainColorTarget.format;
      const depthFormat = view.depth?.format;
      const aoActiveForView =
        this.materialClass.usesAo === true &&
        aoTargets?.perCamera.has(view.sourceEntity as Entity) === true;

      for (const batch of index.batches) {
        const { meshHandle, materialHandle, bucket, depth } = batch.key;
        const renderMesh = renderMeshes.get(meshHandle);
        if (renderMesh === undefined) continue;
        const vertexSlice = allocator.vertexSlice(meshHandle.index);
        if (vertexSlice === undefined) continue;
        let indexSlice: AllocatorSlice | undefined;
        if (renderMesh.bufferInfo.kind === 'indexed') {
          indexSlice = allocator.indexSlice(meshHandle.index);
          if (indexSlice === undefined) continue;
        }
        const prepared = renderMaterials.get(materialHandle);
        if (prepared === undefined) continue;

        const materialInstance = mainWorldMaterials?.get(materialHandle);
        const alphaMode = materialInstance?.alphaMode?.() ?? 'opaque';
        const depthBias = materialInstance?.depthBias?.() ?? 0;
        const doubleSided = materialInstance?.doubleSided?.() ?? false;
        const layout = renderMesh.layout.layout;
        const aoEnabled = aoActiveForView && alphaMode !== 'blend';
        const key: MaterialPipelineKey = {
          msaaSamples: 1,
          hdr: view.hdr,
          vertexLayoutDigest: vertexLayoutDigestFor(layout),
          alphaMode,
          ...(aoEnabled ? { aoEnabled: true } : {}),
          ...(doubleSided ? { doubleSided: true } : {}),
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

    const baseLayouts = (): BindGroupLayout[] => {
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
      return bindGroupLayouts;
    };

    // The skinned variant appends the joint-palette storage buffer at @group(3)
    // (after view/material/lights) and reads it from the SKINNED vertex module.
    // Mutually exclusive with AO, which also uses @group(3).
    const skinned = ctx.key.skinned === true;
    // The morphed variant appends the morph delta/weights/params bind group at
    // @group(3) and reads them from the MORPHED vertex module. Owns @group(3), so
    // mutually exclusive with AO and skinning on this variant.
    const morphed = ctx.key.morphed === true;
    // AO is a lit-only variant: it appends the screen-space AO read binding at
    // @group(3) (after view/material/lights) and shades with the ENABLE_SSAO
    // fragment module. Gated on usesLights so @group(3) always sits at index 3.
    const aoEnabled =
      !skinned && !morphed && ctx.key.aoEnabled === true && this.materialClass.usesLights === true;
    // Combined skinned + morphed: @group(3) holds palette (binding 0) + morph
    // deltas/weights/params (1/2/3), and the vertex module is compiled with both
    // defines (morph applied before skinning).
    const skinnedMorphed = skinned && morphed;
    if (skinnedMorphed) {
      if (this.skinnedMorphedPipelineLayout === undefined) {
        const combinedLayout = (this.app.getResource(MorphGpu) as MorphGpu).ensureCombinedLayout(renderer);
        this.skinnedMorphedPipelineLayout = renderer.createPipelineLayout({
          label: `material#${this.materialClass.name}#skinned-morphed`,
          bindGroupLayouts: [...baseLayouts(), combinedLayout],
        });
      }
    } else if (skinned) {
      if (this.skinnedPipelineLayout === undefined) {
        const paletteLayout = (
          this.app.getResource(SkinnedPaletteGpu) as SkinnedPaletteGpu
        ).ensureLayout(renderer);
        this.skinnedPipelineLayout = renderer.createPipelineLayout({
          label: `material#${this.materialClass.name}#skinned`,
          bindGroupLayouts: [...baseLayouts(), paletteLayout],
        });
      }
    } else if (morphed) {
      if (this.morphedPipelineLayout === undefined) {
        const morphLayout = (this.app.getResource(MorphGpu) as MorphGpu).ensureLayout(renderer);
        this.morphedPipelineLayout = renderer.createPipelineLayout({
          label: `material#${this.materialClass.name}#morphed`,
          bindGroupLayouts: [...baseLayouts(), morphLayout],
        });
      }
    } else if (aoEnabled) {
      if (this.aoPipelineLayout === undefined) {
        const aoLayout = this.app.getResource(AoBindGroupCache)?.readLayout;
        if (aoLayout === undefined) {
          throw new Error(
            `MaterialPlugin<${this.materialClass.name}>: aoEnabled pipeline requested but the AO read @group(3) layout is missing — AoPlugin must initialise before the first AO frame.`,
          );
        }
        this.aoPipelineLayout = renderer.createPipelineLayout({
          label: `material#${this.materialClass.name}#ao`,
          bindGroupLayouts: [...baseLayouts(), aoLayout],
        });
      }
    } else if (this.pipelineLayout === undefined) {
      this.pipelineLayout = renderer.createPipelineLayout({
        label: `material#${this.materialClass.name}`,
        bindGroupLayouts: baseLayouts(),
      });
    }

    const isTransparent = ctx.key.alphaMode === 'blend';
    const descriptor: RenderPipelineDescriptor = {
      label: `material#${this.materialClass.name}#${alphaModeKey(ctx.key.alphaMode)}${aoEnabled ? '#ao' : ''}${skinned ? '#skinned' : ''}${morphed ? '#morphed' : ''}`,
      layout: skinnedMorphed
        ? this.skinnedMorphedPipelineLayout!
        : skinned
          ? this.skinnedPipelineLayout!
          : morphed
            ? this.morphedPipelineLayout!
            : aoEnabled
              ? this.aoPipelineLayout!
              : this.pipelineLayout!,
      vertex: {
        module: skinnedMorphed
          ? this.ensureSkinnedMorphedVertexModule()
          : skinned
            ? this.ensureSkinnedVertexModule()
            : morphed
              ? this.ensureMorphedVertexModule()
              : this.vertexModule,
        entryPoint: this.vertexEntryPoint,
        buffers: [ctx.layout, skinned ? SKINNED_INSTANCE_LAYOUT : INSTANCE_LAYOUT],
      },
      fragment: {
        module: aoEnabled ? this.ensureAoFragmentModule() : this.fragmentModule,
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
        cullMode: ctx.key.doubleSided === true ? 'none' : 'back',
        frontFace: 'ccw',
      },
    };
    if (ctx.depthFormat !== undefined) {
      descriptor.depthStencil = {
        format: ctx.depthFormat,
        depthWriteEnabled: !isTransparent,
        // `less-equal`, not `less`: when a depth prepass has pre-populated the
        // depth buffer, every opaque fragment arrives at exactly the depth the
        // prepass already wrote, so a strict `less` test rejects all of them
        // and the surface never shades. `less-equal` lets the coplanar
        // fragment through; with no prepass it behaves like `less` for visible
        // geometry.
        depthCompare: 'less-equal',
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

    const supportsNormalOut = this.materialSupportsPrepassNormalFragment();
    const supportsMotionOut = this.materialSupportsPrepassMotionFragment();
    const writesNormal = flags.normal && supportsNormalOut;
    const writesMotion = flags.motionVector && supportsMotionOut;

    // The motion-enabled shader module variant declares the previous-instance
    // attributes at @location(4..7) and the motion fragment entries —
    // compile it lazily on the first motion-vector request and reuse.
    const modules = writesMotion
      ? this.ensureMotionShaderModules()
      : { vertex: this.vertexModule, fragment: this.fragmentModule };

    const vertexBuffers = writesMotion
      ? [ctx.layout, INSTANCE_LAYOUT, PREVIOUS_INSTANCE_LAYOUT]
      : [ctx.layout, INSTANCE_LAYOUT];

    const descriptor: RenderPipelineDescriptor = {
      label: `material#${this.materialClass.name}#prepass#${flags.depth ? 'd' : ''}${flags.normal ? 'n' : ''}${flags.motionVector ? 'm' : ''}`,
      layout: this.prepassPipelineLayout,
      vertex: {
        module: modules.vertex,
        entryPoint: 'vs_prepass',
        buffers: vertexBuffers,
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: ctx.key.doubleSided === true ? 'none' : 'back',
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
    // Fragment selection by intersected flags:
    //   normal-only             → fs_prepass_normal (single rgba16float target)
    //   motion-only             → fs_prepass_motion (single rg16float target)
    //   normal + motion         → fs_prepass_normal_motion (both targets, one fragment)
    //   depth-only              → fragment undefined (no color attachment)
    // The combined `normal + motion` fragment keeps the cardinality at one
    // prepass pipeline per opt-in material per flag combination — splitting
    // into two pipelines (one normal, one motion) would double the vertex
    // work for cameras that want both, which is the TAA-friendly default.
    if (writesNormal && writesMotion) {
      descriptor.fragment = {
        module: modules.fragment,
        entryPoint: 'fs_prepass_normal_motion',
        targets: [
          { format: PREPASS_NORMAL_FORMAT },
          { format: PREPASS_MOTION_VECTOR_FORMAT },
        ],
      };
    } else if (writesNormal) {
      descriptor.fragment = {
        module: modules.fragment,
        entryPoint: 'fs_prepass_normal',
        targets: [{ format: PREPASS_NORMAL_FORMAT }],
      };
    } else if (writesMotion) {
      descriptor.fragment = {
        module: modules.fragment,
        entryPoint: 'fs_prepass_motion',
        targets: [{ format: PREPASS_MOTION_VECTOR_FORMAT }],
      };
    }
    // A camera asked for a color-writing prepass channel but no fragment was
    // selected — the material declares the channel in `prepassWrites()` yet
    // does not actually ship the entry. Handing the backend a render pipeline
    // with a color-bearing pass but no fragment targets is invalid; fail loud
    // here instead of letting the device reject an empty-target pipeline.
    if ((flags.normal || flags.motionVector) && descriptor.fragment === undefined) {
      throw new Error(
        `MaterialPlugin<${this.materialClass.name}>: prepass requested normal/motion output but the material exposes no matching fragment entry. ` +
          `prepassWrites() declares { normal: ${this.prepassCapabilities.normal}, motionVector: ${this.prepassCapabilities.motionVector} } — a material that declares a channel must ship its fs_prepass_* entry.`,
      );
    }
    return descriptor;
  }

  /**
   * Lazily compile the `PREPASS_MOTION_VECTOR`-defined variant of this
   * material's vertex and fragment modules. The variant declares the
   * previous-instance attributes at `@location(4..7)` and exposes the
   * `fs_prepass_motion` / `fs_prepass_normal_motion` fragment entries.
   * Materials that never produce a motion-vector prepass pipeline never
   * trigger this path.
   */
  private ensureMotionShaderModules(): { vertex: ShaderModule; fragment: ShaderModule } {
    if (this.motionVertexModule !== undefined && this.motionFragmentModule !== undefined) {
      return { vertex: this.motionVertexModule, fragment: this.motionFragmentModule };
    }
    const cache = this.app.getResource(PipelineCache) as PipelineCache;
    const registry = this.app.getResource(ShaderRegistry) as ShaderRegistry;
    const defines = { PREPASS_MOTION_VECTOR: true } as const;
    this.motionVertexModule = compileShaderFromRef(
      cache,
      registry,
      this.vertexShaderRef,
      `${this.materialClass.name}-vertex+motion`,
      defines,
    );
    this.motionFragmentModule = compileShaderFromRef(
      cache,
      registry,
      this.fragmentShaderRef,
      `${this.materialClass.name}-fragment+motion`,
      defines,
    );
    return { vertex: this.motionVertexModule, fragment: this.motionFragmentModule };
  }

  /**
   * Lazily compile the `ENABLE_SSAO`-defined variant of this material's
   * fragment module. The variant declares the `@group(3)` AO sampler + texture
   * and multiplies the sampled occlusion into the ambient term. Materials that
   * never enable AO never trigger this path. The vertex stage is unchanged, so
   * the base `vertexModule` is reused.
   */
  private ensureAoFragmentModule(): ShaderModule {
    if (this.aoFragmentModule !== undefined) return this.aoFragmentModule;
    const cache = this.app.getResource(PipelineCache) as PipelineCache;
    const registry = this.app.getResource(ShaderRegistry) as ShaderRegistry;
    this.aoFragmentModule = compileShaderFromRef(
      cache,
      registry,
      this.fragmentShaderRef,
      `${this.materialClass.name}-fragment+ao`,
      { ENABLE_SSAO: true },
    );
    return this.aoFragmentModule;
  }

  /**
   * Lazily compile the `SKINNED`-defined variant of this material's vertex
   * module: per-vertex joint indices/weights, the per-instance `joint_offset`,
   * and the `@group(3)` joint-palette storage buffer the vertex stage blends.
   * The fragment stage is unchanged, so the base `fragmentModule` is reused.
   */
  ensureSkinnedVertexModule(): ShaderModule {
    if (this.skinnedVertexModule !== undefined) return this.skinnedVertexModule;
    const cache = this.app.getResource(PipelineCache) as PipelineCache;
    const registry = this.app.getResource(ShaderRegistry) as ShaderRegistry;
    this.skinnedVertexModule = compileShaderFromRef(
      cache,
      registry,
      this.vertexShaderRef,
      `${this.materialClass.name}-vertex+skinned`,
      { SKINNED: true },
    );
    return this.skinnedVertexModule;
  }

  /**
   * Lazily compile the `MORPHED`-defined variant of this material's vertex
   * module: per-mesh blend-shape deltas, the entity's weights, and the morph
   * params at `@group(3)`, blended into the rest pose before skinning. The
   * fragment stage is unchanged, so the base `fragmentModule` is reused.
   */
  ensureMorphedVertexModule(): ShaderModule {
    if (this.morphedVertexModule !== undefined) return this.morphedVertexModule;
    const cache = this.app.getResource(PipelineCache) as PipelineCache;
    const registry = this.app.getResource(ShaderRegistry) as ShaderRegistry;
    this.morphedVertexModule = compileShaderFromRef(
      cache,
      registry,
      this.vertexShaderRef,
      `${this.materialClass.name}-vertex+morphed`,
      { MORPHED: true },
    );
    return this.morphedVertexModule;
  }

  /**
   * Lazily compile the combined `SKINNED` + `MORPHED` vertex module: morph the
   * rest pose, then skin the result, reading the joint palette + morph data from
   * one `@group(3)` bind group. For meshes that both deform and morph (a skinned
   * character with facial blend shapes).
   */
  ensureSkinnedMorphedVertexModule(): ShaderModule {
    if (this.skinnedMorphedVertexModule !== undefined) return this.skinnedMorphedVertexModule;
    const cache = this.app.getResource(PipelineCache) as PipelineCache;
    const registry = this.app.getResource(ShaderRegistry) as ShaderRegistry;
    this.skinnedMorphedVertexModule = compileShaderFromRef(
      cache,
      registry,
      this.vertexShaderRef,
      `${this.materialClass.name}-vertex+skinned+morphed`,
      { SKINNED: true, MORPHED: true },
    );
    return this.skinnedMorphedVertexModule;
  }

  private materialSupportsPrepassNormalFragment(): boolean {
    // A material that declares the normal channel in `prepassWrites()` is
    // promising it ships `fs_prepass_normal`; the declaration is the
    // capability signal. Tied to the declared flags rather than the class
    // name so it survives bundler minification.
    return this.prepassCapabilities.normal;
  }

  private materialSupportsPrepassMotionFragment(): boolean {
    // Sibling of `materialSupportsPrepassNormalFragment`. A material that
    // declares the motion-vector channel in `prepassWrites()` promises it
    // ships `fs_prepass_motion` / `fs_prepass_normal_motion` and the
    // previous-instance attributes at `@location(4..7)` under
    // `#ifdef PREPASS_MOTION_VECTOR`.
    return this.prepassCapabilities.motionVector;
  }
}

const compileShaderFromRef = (
  cache: PipelineCache,
  registry: ShaderRegistry,
  ref: ShaderRef,
  fallbackLabel: string,
  defines?: Record<string, string | number | boolean>,
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
  return cache.compileShader(new Shader(source, { label: ref.name }), defines);
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

// Suppress unused-binding lint: the marker type `PreparedMaterial` is imported
// for documentation TSDoc links above but not referenced in this module's
// runtime code.
void (null as unknown as PreparedMaterial);
