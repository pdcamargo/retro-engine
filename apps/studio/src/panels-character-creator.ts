import type { EditorContext, PanelDef } from '@retro-engine/editor-sdk';
import type {
  App,
  Handle,
  MaterialPlugin,
  Mesh,
  ProxyFitting,
  SparseMorphTarget,
  WeightedMorphTarget,
} from '@retro-engine/engine';
import {
  AssetServer,
  MeshAttribute,
  Mesh3d,
  Meshes,
  ProxyFittings,
  SparseMorphTargets,
  StandardMaterial,
  Transform,
  Visibility,
  bakeMorphedMesh,
  composeMorphedPositions,
  fitProxy,
} from '@retro-engine/engine';
import type { AssetGuid } from '@retro-engine/assets';
import { vec3, vec4 } from '@retro-engine/math';

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
  const bake = (): number | undefined => {
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
    if (cc.matHandle === undefined) {
      cc.matHandle = materials.add(
        new StandardMaterial({ baseColor: vec4.create(0.82, 0.67, 0.57, 1), roughness: 0.75 }),
      );
    }
    const transform = new Transform(vec3.create(0, 0, 0), undefined, vec3.create(1, 1, 1));
    const entity = app.world.spawn(
      new Mesh3d(handle),
      new material.MeshMaterial3d(cc.matHandle),
      transform,
      new Visibility('Visible'),
    );
    cc.bakedCount += 1;
    return entity;
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
    targetAssets: readonly { guid: string; name: string }[],
    garmentAssets: readonly { guid: string; name: string }[],
  ): void => {
    const server = app.getResource(AssetServer);
    if (server === undefined) return;
    cc.phase = 'loading';
    cc.baseGuid = baseGuid;
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
    if (cc.matHandle === undefined) {
      cc.matHandle = materials.add(
        new StandardMaterial({ baseColor: vec4.create(0.82, 0.67, 0.57, 1), roughness: 0.75 }),
      );
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
          load: (): void => beginLoad(baseAsset.guid, targetAssets, garmentAssets),
          setWeight: (name: string, w: number): void => {
            const slot = cc.targets.find((s) => s.name === name);
            if (slot !== undefined) {
              slot.weight = w;
              cc.dirty = true;
            }
          },
          previewEntity: (): number | undefined => cc.previewEntity,
          garmentEntities: (): (number | undefined)[] => cc.garments.map((g) => g.entity),
          bake: (): number | undefined => bake(),
        };

        if (cc.phase === 'idle') {
          if (widgets.button('Load Character', { variant: 'primary' })) {
            beginLoad(baseAsset.guid, targetAssets, garmentAssets);
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
        if (widgets.button('Bake', { variant: 'primary', size: 'sm' })) bake();
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
