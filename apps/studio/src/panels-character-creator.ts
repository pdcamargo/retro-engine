import type { EditorContext, PanelDef } from '@retro-engine/editor-sdk';
import type { App, Handle, MaterialPlugin, Mesh, SparseMorphTarget, WeightedMorphTarget } from '@retro-engine/engine';
import {
  AssetServer,
  MeshAttribute,
  Mesh3d,
  Meshes,
  SparseMorphTargets,
  StandardMaterial,
  Transform,
  Visibility,
  composeMorphedPositions,
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
  dirty: boolean;
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
  const cc: CreatorState = { phase: 'idle', targets: [], dirty: false };

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
    cc.dirty = false;
  };

  const beginLoad = (baseGuid: string, targetAssets: readonly { guid: string; name: string }[]): void => {
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
    if (cc.basePositions !== undefined && cc.targets.every((s) => s.target !== undefined)) cc.phase = 'ready';
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
        const baseAsset = browser.assets.find((a) => a.location.toLowerCase().endsWith('.obj'));
        const targetAssets = browser.assets.filter((a) => a.type === 'morph');
        if (baseAsset === undefined) {
          ui.textDisabled('No base mesh found. Add a .obj (e.g. the MakeHuman base) to the project.');
          return;
        }

        ui.textMuted(`Base: ${baseAsset.name}`);
        ui.textMuted(`${targetAssets.length} morph target(s)`);
        ui.spacing();

        // Dev/test seam: drive the panel from studio_eval (jsimgui ignores
        // synthetic clicks, so MCP verification reaches the actions this way).
        (globalThis as Record<string, unknown>).__characterCreator = {
          state: cc,
          load: (): void => beginLoad(baseAsset.guid, targetAssets),
          setWeight: (name: string, w: number): void => {
            const slot = cc.targets.find((s) => s.name === name);
            if (slot !== undefined) {
              slot.weight = w;
              cc.dirty = true;
            }
          },
          previewEntity: (): number | undefined => cc.previewEntity,
        };

        if (cc.phase === 'idle') {
          if (widgets.button('Load Character', { variant: 'primary' })) {
            beginLoad(baseAsset.guid, targetAssets);
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

        if (cc.dirty) recompose();
      });
    },
  };
};
