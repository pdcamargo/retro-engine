import { ImGui } from '@mori2003/jsimgui';
import type { Entity } from '@retro-engine/ecs';
import { type AssetDragPayload, dragContext } from '@retro-engine/editor-sdk';
import {
  type App,
  AppTypeRegistry,
  AssetServer,
  type CommandsHandle,
  type ComputedCamera,
  GlobalTransform,
  type Handle,
  type Mesh,
  Mesh3d,
  Meshes,
  Name,
  type Scene,
  SceneRoot,
  Transform,
} from '@retro-engine/engine';
import { type Gltf, GltfSceneRoot } from '@retro-engine/gltf';
import { Aabb, mat4, Plane, Ray, rayAabbIntersect, rayPlaneIntersect, type Vec3, vec3 } from '@retro-engine/math';

import { INSTANTIABLE_KINDS, instantiateAsset, type RunCommand } from './dnd-actions';
import { EditorOnly } from './editor-markers';
import { findEditorCamera } from './editor-view';
import type { StudioState } from './state';
import type { ViewportTarget } from './viewport';

/** The transient linked-instance component for a drag preview (markers are unregistered). */
const makeInstanceComponent = (kind: string, handle: Handle<unknown>): object | undefined => {
  if (kind === 'Scene' || kind === 'Prefab') return new SceneRoot(handle as Handle<Scene>);
  if (kind === 'Gltf') return new GltfSceneRoot(handle as Handle<Gltf>);
  if (kind === 'Mesh') return new Mesh3d(handle as Handle<Mesh>);
  return undefined;
};

interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type DropMode = 'instance' | 'material';

interface Captured {
  readonly rect: ViewportRect;
  readonly mouse: [number, number];
  readonly payload: AssetDragPayload;
  readonly mode: DropMode;
  /** Whether the drag was released this frame (a commit). */
  readonly drop: boolean;
}

/** A material handle temporarily swapped onto an entity for the hover preview. */
interface MaterialPreview {
  readonly entity: Entity;
  readonly compName: string;
  readonly previous: Handle<unknown>;
}

const FALLBACK_DISTANCE = 10;

/**
 * Drag-and-drop into the Scene viewport. Mirrors {@link ScenePicker}'s split:
 * {@link capture} reads the in-flight drag in the panel body (UI pass), {@link tick}
 * runs in a `postUpdate` system. Dragging a prefab/scene shows a live instance that
 * follows the cursor on the ground plane and spawns it on release; dragging a
 * material previews it on the hovered mesh and applies it on release. Hover is
 * derived from the viewport rect rather than `IsItemHovered`, which ImGui
 * suppresses while a drag payload is active.
 */
export class SceneDrop {
  private captured: Captured | null = null;
  private readonly ray = new Ray();
  private readonly invViewProj = mat4.identity();
  private readonly worldAabb = new Aabb();
  private readonly plane = new Plane();
  private readonly point: Vec3 = vec3.create(0, 0, 0);

  private previewEntity: Entity | null = null;
  private previewKey: string | null = null;
  private material: MaterialPreview | null = null;

  constructor(
    private readonly app: App,
    private readonly view: ViewportTarget,
    private readonly state: StudioState,
    private readonly runCommand: RunCommand,
  ) {}

  /** Record this frame's drag-over state. Call from the Scene panel body. */
  capture(rect: ViewportRect): void {
    const payload = dragContext.peek();
    if (payload === null || payload.kind !== 'asset') {
      this.captured = null;
      return;
    }
    const m = ImGui.GetMousePos();
    const inside =
      m.x >= rect.x && m.x < rect.x + rect.width && m.y >= rect.y && m.y < rect.y + rect.height;
    if (!inside) {
      this.captured = null;
      return;
    }
    const asset = payload as AssetDragPayload;
    const mode = this.classify(asset);
    if (mode === null) {
      this.captured = null;
      return;
    }
    this.captured = {
      rect,
      mouse: [m.x, m.y],
      payload: asset,
      mode,
      drop: ImGui.IsMouseReleased(0),
    };
  }

  /** Resolve the pending drag/drop. Call from a `postUpdate` system with `Commands`. */
  tick(cmd: CommandsHandle): void {
    const cap = this.captured;
    this.captured = null;

    if (cap !== null && cap.mode === 'instance') {
      this.tickInstance(cmd, cap);
    } else {
      this.teardownPreview(cmd);
    }

    if (cap !== null && cap.mode === 'material') {
      this.tickMaterial(cap);
    } else {
      this.restoreMaterial();
    }
  }

  private classify(payload: AssetDragPayload): DropMode | null {
    if (INSTANTIABLE_KINDS.has(payload.assetKind)) return 'instance';
    if (payload.assetType === 'material') return 'material';
    return null;
  }

  // ---- instance preview + drop: scene / prefab / glTF / mesh (AC#5/#6) ----

  private tickInstance(cmd: CommandsHandle, cap: Captured): void {
    const world = this.app.world;
    const pos = this.worldPointAt(cap);
    if (pos === null) {
      this.teardownPreview(cmd);
      return;
    }
    const kind = cap.payload.assetKind;
    if (cap.drop) {
      this.teardownPreview(cmd);
      instantiateAsset(this.runCommand, cap.payload.guid, kind, {
        position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
      });
      return;
    }
    const key = `${kind}:${cap.payload.guid}`;
    if (this.previewEntity === null || this.previewKey !== key) {
      this.teardownPreview(cmd);
      this.spawnPreview(cmd, kind, cap.payload.guid, pos, key);
      return;
    }
    const t = world.getComponent(this.previewEntity, Transform);
    if (t !== undefined) {
      t.translation[0] = pos[0] ?? 0;
      t.translation[1] = pos[1] ?? 0;
      t.translation[2] = pos[2] ?? 0;
      world.markChanged(this.previewEntity, Transform);
    }
  }

  private spawnPreview(cmd: CommandsHandle, kind: string, guid: string, pos: Vec3, key: string): void {
    const server = this.app.getResource(AssetServer);
    if (server === undefined) return;
    const handle = server.loadByGuid(guid as never);
    const instance = makeInstanceComponent(kind, handle);
    if (instance === undefined) return;
    const t = new Transform();
    t.translation[0] = pos[0] ?? 0;
    t.translation[1] = pos[1] ?? 0;
    t.translation[2] = pos[2] ?? 0;
    const parts: object[] = [new Name('(preview)'), t, new EditorOnly(), instance];
    if (kind === 'Mesh') {
      const matReg = this.app.getResource(AppTypeRegistry)?.registry.get('MeshMaterial3d<StandardMaterial>');
      if (matReg !== undefined) parts.push(matReg.make());
    }
    // EditorOnly keeps the transient preview out of saves and the authored tree.
    this.previewEntity = cmd.spawn(...parts).id;
    this.previewKey = key;
  }

  private componentReg(name: string): (new (...args: never[]) => object) | undefined {
    return this.app.getResource(AppTypeRegistry)?.registry.get(name)?.ctor as
      | (new (...args: never[]) => object)
      | undefined;
  }

  private teardownPreview(cmd: CommandsHandle): void {
    if (this.previewEntity !== null && this.app.world.hasEntity(this.previewEntity)) {
      cmd.entity(this.previewEntity).despawn();
    }
    this.previewEntity = null;
    this.previewKey = null;
  }

  private worldPointAt(cap: Captured): Vec3 | null {
    const editor = findEditorCamera(this.app, this.view);
    if (editor === undefined) return null;
    const computed: ComputedCamera = editor.camera.computed;
    mat4.inverse(computed.viewProjectionMatrix, this.invViewProj);
    Ray.fromScreen(
      cap.mouse[0] - cap.rect.x,
      cap.mouse[1] - cap.rect.y,
      0,
      0,
      cap.rect.width,
      cap.rect.height,
      this.invViewProj,
      this.ray,
    );
    // Drop onto the work plane: the ground (y=0) in 3D, the z=0 plane in 2D.
    if (this.state.viewMode === '2d') this.plane.setFromCoefficients(0, 0, 1, 0);
    else this.plane.setFromCoefficients(0, 1, 0, 0);
    const t = rayPlaneIntersect(this.ray, this.plane);
    const at = Number.isFinite(t) && t > 0 ? t : FALLBACK_DISTANCE;
    return this.ray.at(at, this.point);
  }

  // ---- material preview + apply (AC#7, nice-to-have) ----

  private tickMaterial(cap: Captured): void {
    const entity = this.pickEntity(cap);
    if (entity === null) {
      this.restoreMaterial();
      return;
    }
    const materialKind = cap.payload.assetKind;
    const compName = `MeshMaterial3d<${materialKind}>`;

    if (cap.drop) {
      // Restore first so the command records the true previous handle, then apply.
      this.restoreMaterial();
      void this.runCommand('material.apply', { entity, guid: cap.payload.guid, materialKind }).catch(
        (err: unknown) => console.warn('[studio] material drop failed', err),
      );
      return;
    }

    if (this.material !== null && this.material.entity === entity && this.material.compName === compName) {
      return; // already previewing this material on this entity
    }
    this.restoreMaterial();
    this.previewMaterial(entity, compName, cap.payload.guid);
  }

  private previewMaterial(entity: Entity, compName: string, guid: string): void {
    const server = this.app.getResource(AssetServer);
    const typeReg = this.componentReg(compName);
    if (server === undefined || typeReg === undefined) return;
    const comp = this.app.world.getComponent(entity, typeReg) as { handle: Handle<unknown> } | undefined;
    if (comp === undefined) return; // only preview when the mesh already has this material slot
    this.material = { entity, compName, previous: comp.handle };
    comp.handle = server.loadByGuid(guid as never);
    this.app.world.markChanged(entity, typeReg);
  }

  private restoreMaterial(): void {
    const m = this.material;
    this.material = null;
    if (m === null || !this.app.world.hasEntity(m.entity)) return;
    const typeReg = this.componentReg(m.compName);
    if (typeReg === undefined) return;
    const comp = this.app.world.getComponent(m.entity, typeReg) as { handle: Handle<unknown> } | undefined;
    if (comp === undefined) return;
    comp.handle = m.previous;
    this.app.world.markChanged(m.entity, typeReg);
  }

  private pickEntity(cap: Captured): Entity | null {
    const editor = findEditorCamera(this.app, this.view);
    if (editor === undefined) return null;
    const meshes = this.app.getResource(Meshes);
    if (meshes === undefined) return null;
    const computed: ComputedCamera = editor.camera.computed;
    mat4.inverse(computed.viewProjectionMatrix, this.invViewProj);
    Ray.fromScreen(
      cap.mouse[0] - cap.rect.x,
      cap.mouse[1] - cap.rect.y,
      0,
      0,
      cap.rect.width,
      cap.rect.height,
      this.invViewProj,
      this.ray,
    );
    let best: Entity | null = null;
    let bestT = Infinity;
    for (const [entity, mesh3d, global] of this.app.world.query([Mesh3d, GlobalTransform]).entries()) {
      if (entity === this.previewEntity) continue;
      const mesh = meshes.get(mesh3d.handle);
      if (mesh === undefined) continue;
      Aabb.transform(mesh.computeAabb(this.worldAabb), global.matrix, this.worldAabb);
      const t = rayAabbIntersect(this.ray, this.worldAabb);
      if (t !== null && t < bestT) {
        bestT = t;
        best = entity;
      }
    }
    return best;
  }
}
