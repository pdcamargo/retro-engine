import type { Entity } from '@retro-engine/ecs';
import type { EditorContext, PanelDef } from '@retro-engine/editor-sdk';
import type {
  App,
  Handle,
  Image,
  MakeHumanRig,
  MaterialPlugin,
  ProxyFitting,
  SparseMorphTarget,
  WeightedMorphTarget,
} from '@retro-engine/engine';
import {
  AssetServer,
  Mesh,
  MeshAttribute,
  Mesh3d,
  Meshes,
  Name,
  ProxyFittings,
  SkinnedPalettes,
  SparseMorphTargets,
  StandardMaterial,
  Transform,
  Visibility,
  applySkinWeights,
  bakeMorphedMesh,
  buildRigPose,
  composeMorphedPositions,
  fitProxy,
  parseMakeHumanRig,
  parseMakeHumanWeights,
  spawnRig,
  u16Indices,
  u32Indices,
} from '@retro-engine/engine';
import type { AssetGuid } from '@retro-engine/assets';
import { quat, vec3, vec4 } from '@retro-engine/math';

import type { StudioState } from './state';

/** One morph-target slider: the asset to drive and its current weight. */
interface TargetSlot {
  readonly guid: string;
  readonly name: string;
  handle?: Handle<SparseMorphTarget>;
  target?: SparseMorphTarget;
  weight: number;
}

/** One garment: its `.mhclo` fitting + proxy mesh, re-fitted onto the body each edit. */
interface GarmentSlot {
  readonly name: string;
  readonly fittingGuid: string;
  fittingHandle?: Handle<ProxyFitting>;
  fitting?: ProxyFitting;
  /** The proxy geometry mesh (an `ObjMesh`); its positions are overwritten by the fit. */
  meshGuid?: string;
  meshHandle?: Handle<Mesh>;
  scratch?: Float32Array;
  entity?: number;
  fitted?: boolean;
}

interface CreatorState {
  phase: 'idle' | 'loading' | 'ready';
  baseGuid?: string;
  /** The base mesh's project location — where a co-located skin texture is looked up. */
  baseLocation?: string;
  baseHandle?: Handle<Mesh>;
  /** Pristine base positions, captured at load — the composition source. */
  basePositions?: Float32Array;
  /** Reused composition destination. */
  scratch?: Float32Array;
  matHandle?: Handle<StandardMaterial>;
  previewEntity?: number;
  targets: TargetSlot[];
  garments: GarmentSlot[];
  dirty: boolean;
  bakedCount: number;
  /** The spawned RetroHuman preset (skinned humanoid), once created. */
  retro?: RetroHumanInstance;
  retroStatus?: string;
  /** Spawn requested but waiting on the base mesh to finish loading. */
  retroPending?: boolean;
  /** A spawn is in flight (async rig/weights read) — guards against double-spawn. */
  retroSpawning?: boolean;
}

/** A spawned RetroHuman: its mesh entity, joint entities (palette order), and source rig. */
interface RetroHumanInstance {
  readonly entity: Entity;
  readonly joints: Entity[];
  readonly rig: MakeHumanRig;
}

const SLIDER_RANGE = { min: 0, max: 1 } as const;

/**
 * The CHARACTER panel: load the MakeHuman base mesh + the project's morph targets,
 * then drive a `[0,1]` slider per target. Each edit composes the weighted sparse
 * deltas onto the base on the CPU (`composeMorphedPositions`), writes the result
 * into the live preview mesh, and recomputes normals — the edit-time, zero-runtime
 * customization surface (ADR-0131). The base loads from any `.obj` in the project
 * (an `ObjMesh` asset); targets are every `morph` asset the browser lists.
 */
export const characterCreatorPanel = (
  state: StudioState,
  app: App,
  material: MaterialPlugin<StandardMaterial>,
  persistMaterial?: (value: StandardMaterial) => Promise<Handle<StandardMaterial> | undefined>,
): PanelDef => {
  const cc: CreatorState = { phase: 'idle', targets: [], garments: [], dirty: false, bakedCount: 0 };

  /** Current body positions: the last composed result, or the neutral base before any edit. */
  const bodyPositions = (): Float32Array | undefined => cc.scratch ?? cc.basePositions;

  /** Re-fit every ready garment onto the current body shape. */
  const refitGarments = (): void => {
    const meshes = app.getResource(Meshes);
    const body = bodyPositions();
    if (meshes === undefined || body === undefined) return;
    for (const g of cc.garments) {
      if (g.fitting === undefined || g.meshHandle === undefined) continue;
      if (g.scratch === undefined) g.scratch = new Float32Array(g.fitting.count * 3);
      fitProxy(body, g.fitting, g.scratch);
      const mesh = meshes.getMut(g.meshHandle);
      const pos = mesh?.getAttribute(MeshAttribute.POSITION);
      if (mesh === undefined || pos === undefined) continue;
      (pos.data as Float32Array).set(g.scratch);
      if (mesh.indices !== undefined) mesh.computeSmoothNormals();
      g.fitted = true;
    }
  };

  /** Freeze the current weights into a fresh static mesh and spawn it as a standalone character. */
  const bake = async (): Promise<number | undefined> => {
    const meshes = app.getResource(Meshes);
    const materials = app.getResource(material.Materials);
    if (meshes === undefined || materials === undefined) return undefined;
    if (cc.baseHandle === undefined || cc.basePositions === undefined) return undefined;
    const baseMesh = meshes.get(cc.baseHandle);
    if (baseMesh === undefined) return undefined;
    const active: WeightedMorphTarget[] = [];
    for (const slot of cc.targets) {
      if (slot.target !== undefined && slot.weight !== 0) active.push({ target: slot.target, weight: slot.weight });
    }
    const baked = bakeMorphedMesh(baseMesh, cc.basePositions, active, `baked-character-${cc.bakedCount}`);
    const handle = meshes.add(baked);
    // The baked character is a standalone asset: persist its skin material as a `.remat`
    // (textured when staged) so it references a real, reloadable material by GUID.
    const matHandle = await persistSkinMaterial(buildSkinMaterial(cc.baseLocation ?? ''), materials);
    const transform = new Transform(vec3.create(0, 0, 0), undefined, vec3.create(1, 1, 1));
    const entity = app.world.spawn(
      new Mesh3d(handle),
      new material.MeshMaterial3d(matHandle),
      transform,
      new Visibility('Visible'),
    );
    cc.bakedCount += 1;
    return entity;
  };

  /**
   * Resolve a skin texture co-located with the base mesh (same folder, an `image`
   * asset whose location matches a naming needle) into a GUID-backed `Handle<Image>`.
   * The handle is valid immediately — the renderer falls back to the default texture
   * until the async image upload lands, then picks up the skin.
   */
  const findSkinTexture = (baseLoc: string, needles: readonly string[]): Handle<Image> | undefined => {
    const server = app.getResource(AssetServer);
    if (server === undefined) return undefined;
    const dir = baseLoc.replace(/[^/]*$/, '').toLowerCase();
    const hit = (state.browser?.assets ?? []).find((a) => {
      if (a.type !== 'image') return false;
      const loc = a.location.toLowerCase();
      return loc.startsWith(dir) && needles.some((n) => loc.includes(n));
    });
    return hit !== undefined ? (server.loadByGuid(hit.guid as AssetGuid) as Handle<Image>) : undefined;
  };

  /**
   * Build the character skin material value: textured (skin albedo, plus normal /
   * roughness maps when staged) when a skin texture sits alongside the base mesh,
   * else a flat skin-tone fallback. Pure value — persisting it is the caller's call.
   */
  const buildSkinMaterial = (baseLoc: string): StandardMaterial => {
    const albedo = findSkinTexture(baseLoc, ['skin', 'diffuse', 'albedo']);
    if (albedo === undefined) {
      return new StandardMaterial({ baseColor: vec4.create(0.82, 0.67, 0.57, 1), roughness: 0.75 });
    }
    const normalMap = findSkinTexture(baseLoc, ['normal']);
    const roughMap = findSkinTexture(baseLoc, ['rough', 'spec']);
    return new StandardMaterial({
      baseColorTexture: albedo,
      roughness: roughMap !== undefined ? 1 : 0.7,
      ...(normalMap !== undefined ? { normalMapTexture: normalMap } : {}),
      ...(roughMap !== undefined ? { metallicRoughnessTexture: roughMap } : {}),
    });
  };

  /**
   * Persist a textured skin material as a reloadable `.remat` (returning a GUID-backed
   * handle) when a project sink is available; otherwise add it in-memory. A flat
   * fallback material (no texture) is always added in-memory — there is nothing to
   * persist. Shared by the spawned RetroHuman and baked characters.
   */
  const persistSkinMaterial = async (
    mat: StandardMaterial,
    materials: { add: (m: StandardMaterial) => Handle<StandardMaterial> },
  ): Promise<Handle<StandardMaterial>> => {
    if (mat.baseColorTexture !== undefined && persistMaterial !== undefined) {
      return (await persistMaterial(mat)) ?? materials.add(mat);
    }
    return materials.add(mat);
  };

  /**
   * Spawn the RetroHuman preset: load the CC0 base mesh + `game_engine` rig +
   * weights, build a skinned humanoid (its own mesh so the rigid preview is
   * untouched), and place it in the world (ADR-0134). The rig/weights are read
   * by convention from the base mesh's folder, parsed against the base vertex
   * count, and turned into a joint hierarchy + `Skeleton`.
   */
  const spawnRetroHuman = async (
    baseGuid: string,
    baseLocation: string,
  ): Promise<{ entity: number; jointCount: number } | undefined> => {
    const server = app.getResource(AssetServer);
    const meshes = app.getResource(Meshes);
    const materials = app.getResource(material.Materials);
    const source = state.assetSource;
    if (server === undefined || meshes === undefined || materials === undefined || source === null) {
      cc.retroStatus = 'no project / asset source';
      return undefined;
    }

    const baseHandle = cc.baseHandle ?? (server.loadByGuid(baseGuid as AssetGuid) as Handle<Mesh>);
    const baseMesh = meshes.get(baseHandle);
    const pos = baseMesh?.getAttribute(MeshAttribute.POSITION);
    const uv = baseMesh?.getAttribute(MeshAttribute.UV_0);
    if (baseMesh === undefined || pos === undefined || uv === undefined) {
      cc.retroStatus = 'base mesh not loaded yet — Load Character first';
      return undefined;
    }
    const nor = baseMesh.getAttribute(MeshAttribute.NORMAL);
    const vertexCount = baseMesh.vertexCount;

    const dir = baseLocation.replace(/[^/]*$/, '');
    const dec = new TextDecoder();
    let rig: MakeHumanRig;
    let weights: ReturnType<typeof parseMakeHumanWeights>;
    try {
      rig = parseMakeHumanRig(dec.decode(await source.read(`${dir}rig.game_engine.json`)));
      weights = parseMakeHumanWeights(
        dec.decode(await source.read(`${dir}weights.game_engine.json`)),
        rig,
        vertexCount,
      );
    } catch (err) {
      cc.retroStatus = `rig/weights load failed: ${String(err)}`;
      return undefined;
    }
    const pose = buildRigPose(rig);

    // Isolated skinned mesh in the canonical attribute order the skinned shader
    // reads: POSITION(0), NORMAL(1), UV(2), JOINTS_0(3), WEIGHTS_0(4).
    const human = new Mesh({ label: 'retrohuman-body' });
    human.insertAttribute(MeshAttribute.POSITION, new Float32Array(pos.data as Float32Array));
    human.insertAttribute(
      MeshAttribute.NORMAL,
      nor !== undefined ? new Float32Array(nor.data as Float32Array) : new Float32Array(vertexCount * 3),
    );
    human.insertAttribute(MeshAttribute.UV_0, new Float32Array(uv.data as Float32Array));
    const idx = baseMesh.indices;
    if (idx !== undefined) {
      human.setIndices(idx.kind === 'u16' ? u16Indices(new Uint16Array(idx.data)) : u32Indices(new Uint32Array(idx.data)));
    }
    if (nor === undefined && human.indices !== undefined) human.computeSmoothNormals();
    applySkinWeights(human, weights);
    const humanHandle = meshes.add(human);

    // Skin material: textured + persisted as a `.remat` when a skin texture is staged
    // alongside the base mesh (so the spawned character references a real, reloadable
    // material by GUID); otherwise a flat skin-tone fallback so the spawn never fails.
    const skinMat = buildSkinMaterial(baseLocation);
    const matHandle = await persistSkinMaterial(skinMat, materials);

    const { joints, skeleton } = spawnRig(app.world, pose, { names: rig.bones.map((b) => b.name) });
    const entity = app.world.spawn(
      new Name('RetroHuman'),
      new Mesh3d(humanHandle),
      new material.MeshMaterial3d(matHandle),
      new Transform(vec3.create(0, 0, 0), undefined, vec3.create(1, 1, 1)),
      new Visibility('Visible'),
      skeleton,
    );
    cc.retro = { entity, joints, rig };
    cc.retroStatus = `spawned · ${joints.length} joints`;
    return { entity, jointCount: joints.length };
  };

  /** Drive a pending RetroHuman spawn: wait for the base mesh, then spawn once. */
  const pollRetro = (baseGuid: string, baseLocation: string): void => {
    if (cc.retroPending !== true || cc.retroSpawning === true || cc.retro !== undefined) return;
    const meshes = app.getResource(Meshes);
    const ready =
      cc.baseHandle !== undefined &&
      meshes?.get(cc.baseHandle)?.getAttribute(MeshAttribute.POSITION) !== undefined;
    if (!ready) {
      cc.retroStatus = 'loading base mesh…';
      return;
    }
    cc.retroSpawning = true;
    void spawnRetroHuman(baseGuid, baseLocation).finally(() => {
      cc.retroSpawning = false;
      cc.retroPending = false;
    });
  };

  const recompose = (): void => {
    const meshes = app.getResource(Meshes);
    if (cc.baseHandle === undefined || cc.basePositions === undefined || cc.scratch === undefined) return;
    const active: WeightedMorphTarget[] = [];
    for (const slot of cc.targets) {
      if (slot.target !== undefined && slot.weight !== 0) active.push({ target: slot.target, weight: slot.weight });
    }
    composeMorphedPositions(cc.basePositions, active, cc.scratch);
    const mesh = meshes?.getMut(cc.baseHandle);
    if (mesh === undefined) return;
    const pos = mesh.getAttribute(MeshAttribute.POSITION);
    if (pos === undefined) return;
    (pos.data as Float32Array).set(cc.scratch);
    mesh.computeSmoothNormals();
    refitGarments();
    cc.dirty = false;
  };

  const beginLoad = (
    baseGuid: string,
    baseLocation: string,
    targetAssets: readonly { guid: string; name: string }[],
    garmentAssets: readonly { guid: string; name: string }[],
  ): void => {
    const server = app.getResource(AssetServer);
    if (server === undefined) return;
    cc.phase = 'loading';
    cc.baseGuid = baseGuid;
    cc.baseLocation = baseLocation;
    cc.baseHandle = server.loadByGuid(baseGuid as AssetGuid) as Handle<Mesh>;
    cc.targets = targetAssets.map((a) => ({
      guid: a.guid,
      name: a.name.replace(/\.target$/i, ''),
      handle: server.loadByGuid(a.guid as AssetGuid) as Handle<SparseMorphTarget>,
      weight: 0,
    }));
    cc.garments = garmentAssets.map((a) => ({
      name: a.name.replace(/\.mhclo$/i, ''),
      fittingGuid: a.guid,
      fittingHandle: server.loadByGuid(a.guid as AssetGuid) as Handle<ProxyFitting>,
    }));
  };

  const pollLoad = (): void => {
    const meshes = app.getResource(Meshes);
    const targetStore = app.getResource(SparseMorphTargets);
    if (cc.basePositions === undefined && cc.baseHandle !== undefined) {
      const mesh = meshes?.get(cc.baseHandle);
      const pos = mesh?.getAttribute(MeshAttribute.POSITION);
      if (mesh !== undefined && pos !== undefined) {
        cc.basePositions = new Float32Array(pos.data as Float32Array);
        cc.scratch = new Float32Array(cc.basePositions.length);
        spawnPreview();
      }
    }
    for (const slot of cc.targets) {
      if (slot.target === undefined && slot.handle !== undefined) {
        const t = targetStore?.get(slot.handle);
        if (t !== undefined) slot.target = t;
      }
    }

    const server = app.getResource(AssetServer);
    const fittingStore = app.getResource(ProxyFittings);
    const browserAssets = state.browser?.assets ?? [];
    for (const g of cc.garments) {
      if (g.fitting === undefined && g.fittingHandle !== undefined) {
        const f = fittingStore?.get(g.fittingHandle);
        if (f !== undefined) g.fitting = f;
      }
      // Resolve the proxy geometry .obj from the fitting's objFile (by basename).
      if (g.fitting !== undefined && g.meshHandle === undefined && server !== undefined) {
        const objName = (g.fitting.objFile ?? '').split(/[\\/]/).pop()?.toLowerCase();
        const objAsset =
          objName !== undefined ? browserAssets.find((a) => a.location.toLowerCase().endsWith(objName)) : undefined;
        if (objAsset !== undefined) {
          g.meshGuid = objAsset.guid;
          g.meshHandle = server.loadByGuid(objAsset.guid as AssetGuid) as Handle<Mesh>;
        }
      }
      // Spawn the garment once its proxy mesh is loaded.
      if (g.entity === undefined && g.meshHandle !== undefined && meshes?.get(g.meshHandle) !== undefined) {
        const materials = app.getResource(material.Materials);
        if (materials !== undefined) {
          const matHandle = materials.add(
            new StandardMaterial({ baseColor: vec4.create(0.3, 0.4, 0.7, 1), roughness: 0.6 }),
          );
          g.entity = app.world.spawn(
            new Mesh3d(g.meshHandle),
            new material.MeshMaterial3d(matHandle),
            new Transform(vec3.create(0, 0, 0), undefined, vec3.create(1, 1, 1)),
            new Visibility('Visible'),
          );
          cc.dirty = true; // fit the garment onto the current body next recompose
        }
      }
    }

    const garmentsReady = cc.garments.every((g) => g.fitting !== undefined && g.entity !== undefined);
    if (cc.basePositions !== undefined && cc.targets.every((s) => s.target !== undefined) && garmentsReady) {
      cc.phase = 'ready';
      if (cc.garments.length > 0) cc.dirty = true; // ensure an initial fit
    }
  };

  const spawnPreview = (): void => {
    if (cc.previewEntity !== undefined || cc.baseHandle === undefined) return;
    const materials = app.getResource(material.Materials);
    if (materials === undefined) return;
    // The preview is a transient editing surface, so its skin material stays in-memory
    // (textured when a skin is staged, else flat) — no `.remat` is persisted for it.
    if (cc.matHandle === undefined) {
      cc.matHandle = materials.add(buildSkinMaterial(cc.baseLocation ?? ''));
    }
    const transform = new Transform(vec3.create(0, 0, 0), undefined, vec3.create(1, 1, 1));
    cc.previewEntity = app.world.spawn(
      new Mesh3d(cc.baseHandle),
      new material.MeshMaterial3d(cc.matHandle),
      transform,
      new Visibility('Visible'),
    );
  };

  return {
    id: '/character-creator',
    title: 'Character',
    icon: 'scan-face',
    slot: 'right',
    closable: true,
    flush: true,
    render: ({ ui, widgets }: EditorContext): void => {
      ui.child('cc-body', { size: [0, 0], border: false, padding: [12, 10] }, () => {
        const browser = state.browser;
        if (browser === null) {
          ui.textDisabled('Open a project containing a base .obj and morph targets.');
          return;
        }
        // Prefer a file literally named base.obj; garments now also add `.obj` assets.
        const objs = browser.assets.filter((a) => a.location.toLowerCase().endsWith('.obj'));
        const baseAsset = objs.find((a) => a.location.toLowerCase().endsWith('base.obj')) ?? objs[0];
        const targetAssets = browser.assets.filter((a) => a.type === 'morph');
        const garmentAssets = browser.assets.filter((a) => a.type === 'garment');
        if (baseAsset === undefined) {
          ui.textDisabled('No base mesh found. Add a .obj (e.g. the MakeHuman base) to the project.');
          return;
        }

        ui.textMuted(`Base: ${baseAsset.name}`);
        ui.textMuted(`${targetAssets.length} morph target(s) · ${garmentAssets.length} garment(s)`);
        ui.spacing();

        // Dev/test seam: drive the panel from studio_eval (jsimgui ignores
        // synthetic clicks, so MCP verification reaches the actions this way).
        (globalThis as Record<string, unknown>).__characterCreator = {
          state: cc,
          load: (): void => beginLoad(baseAsset.guid, baseAsset.location, targetAssets, garmentAssets),
          setWeight: (name: string, w: number): void => {
            const slot = cc.targets.find((s) => s.name === name);
            if (slot !== undefined) {
              slot.weight = w;
              cc.dirty = true;
            }
          },
          previewEntity: (): number | undefined => cc.previewEntity,
          garmentEntities: (): (number | undefined)[] => cc.garments.map((g) => g.entity),
          bake: (): Promise<number | undefined> => bake(),
          spawnRetroHuman: (): Promise<{ entity: number; jointCount: number } | undefined> =>
            spawnRetroHuman(baseAsset.guid, baseAsset.location),
          retro: (): RetroHumanInstance | undefined => cc.retro,
          // Verification seam: rotate one joint by `angle` rad about `axis` and
          // mark it changed so propagation + the skinning palette follow it.
          poseJoint: (name: string, ax: number, ay: number, az: number, angle: number): boolean => {
            if (cc.retro === undefined) return false;
            const ji = cc.retro.rig.indexOf.get(name);
            if (ji === undefined) return false;
            const joint = cc.retro.joints[ji];
            if (joint === undefined) return false;
            const t = app.world.getComponent(joint, Transform);
            if (t === undefined) return false;
            t.rotation = quat.fromAxisAngle(vec3.create(ax, ay, az), angle, quat.create());
            app.world.markChanged(joint, Transform);
            return true;
          },
          // The 16-float skinning-palette matrix for a joint (by rig bone name) —
          // its translation columns prove the GPU skin input moved when posed.
          palette: (name: string): number[] | undefined => {
            if (cc.retro === undefined) return undefined;
            const ji = cc.retro.rig.indexOf.get(name);
            if (ji === undefined) return undefined;
            const palettes = app.getResource(SkinnedPalettes);
            const pal = palettes?.byEntity.get(cc.retro.entity as Entity);
            if (pal === undefined) return undefined;
            return Array.from(pal.data.slice(ji * 16, ji * 16 + 16));
          },
        };

        // RetroHuman preset — a one-click skinned humanoid (base + rig + weights),
        // available in any phase; it loads the base on demand if needed.
        ui.separatorText('RetroHuman');
        if (cc.retro === undefined) {
          if (widgets.button('Spawn RetroHuman', { variant: 'primary', size: 'sm' })) {
            if (cc.phase === 'idle') beginLoad(baseAsset.guid, baseAsset.location, targetAssets, garmentAssets);
            cc.retroPending = true;
          }
        } else {
          ui.textMuted('RetroHuman spawned.');
        }
        if (cc.retroStatus !== undefined) ui.textMuted(cc.retroStatus);
        pollRetro(baseAsset.guid, baseAsset.location);
        ui.spacing();

        if (cc.phase === 'idle') {
          if (widgets.button('Load Character', { variant: 'primary' })) {
            beginLoad(baseAsset.guid, baseAsset.location, targetAssets, garmentAssets);
          }
          return;
        }
        if (cc.phase === 'loading') {
          pollLoad();
          ui.textDisabled('Loading base mesh + targets…');
          return;
        }

        // ready
        if (widgets.button('Reset', { variant: 'secondary', size: 'sm' })) {
          for (const slot of cc.targets) slot.weight = 0;
          cc.dirty = true;
        }
        ui.sameLine();
        if (widgets.button('Bake', { variant: 'primary', size: 'sm' })) void bake();
        if (cc.bakedCount > 0) ui.textMuted(`${cc.bakedCount} baked`);
        ui.spacing();
        ui.separatorText('Targets');
        for (const slot of cc.targets) {
          ui.textMuted(slot.name);
          const next = widgets.slider(`cc-${slot.guid}`, slot.weight, SLIDER_RANGE);
          if (next !== slot.weight) {
            slot.weight = next;
            cc.dirty = true;
          }
        }

        if (cc.garments.length > 0) {
          ui.spacing();
          ui.separatorText('Garments');
          for (const g of cc.garments) {
            ui.textMuted(`${g.name} — ${g.fitted === true ? 'fitted' : 'loading'}`);
          }
        }

        if (cc.dirty) recompose();
      });
    },
  };
};
