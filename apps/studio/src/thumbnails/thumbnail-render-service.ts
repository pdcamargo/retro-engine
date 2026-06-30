import { ImGuiImplWeb, type ImTextureRef } from '@mori2003/jsimgui';
import type { Entity } from '@retro-engine/ecs';
import {
  type App,
  AppTypeRegistry,
  AssetServer,
  Camera,
  Camera3d,
  CameraRenderTarget,
  ClearColorConfig,
  type CommandsHandle,
  Children,
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
import { Aabb, mat4, quat, type Vec3, vec3 } from '@retro-engine/math';
import { type Renderer, type Texture, TextureUsage } from '@retro-engine/renderer-core';
import { GPU_TEXTURE, type InternalTexture } from '@retro-engine/renderer-webgpu';

import { EditorOnly } from '../editor-markers';

const SIZE = 256;
const FOV = 0.62; // ~35.5°
// Stage the asset far from the authored scene so the main camera never frames it
// (3D lights are global, so the scene's sun/ambient still light it — matching the
// editor view) and no per-entity render-layer juggling is needed for isolation.
const STAGE: readonly [number, number, number] = [0, -100000, 0];
const VIEW_DIR = ((): Vec3 => vec3.normalize(vec3.create(1, 0.85, 1)))(); // 3/4 framing

/** A `Transform` positioned at the far staging point (set by index to avoid Vec3 type variance). */
const stagedTransform = (): Transform => {
  const t = new Transform();
  t.translation[0] = STAGE[0];
  t.translation[1] = STAGE[1];
  t.translation[2] = STAGE[2];
  return t;
};
const SETTLE_FRAMES = 2; // frames to render after framing before capturing
const LOAD_BUDGET = 240; // ~4s at 60fps to instantiate + load before giving up
const MIN_LOAD_FRAMES = 10; // let async asset loads settle before framing

type Phase = 'loading' | 'settle';

interface Job {
  readonly guid: string;
  readonly kind: string;
  readonly texture: Texture;
  root: Entity;
  phase: Phase;
  frames: number;
  /** Bounds radius last seen, to detect when the streaming instance has settled. */
  lastRadius: number;
  stableFrames: number;
}

/** Largest half-extent of an AABB (its bounding radius). */
const radiusOf = (aabb: Aabb): number =>
  Math.max(aabb.halfExtents[0] ?? 0, aabb.halfExtents[1] ?? 0, aabb.halfExtents[2] ?? 0);

const makeInstanceComponent = (kind: string, handle: Handle<unknown>): object | undefined => {
  if (kind === 'Scene' || kind === 'Prefab') return new SceneRoot(handle as Handle<Scene>);
  if (kind === 'Gltf') return new GltfSceneRoot(handle as Handle<Gltf>);
  if (kind === 'Mesh') return new Mesh3d(handle as Handle<Mesh>);
  return undefined;
};

/**
 * Renders asset previews by instantiating the asset into the live world (staged
 * far from the authored scene), framing it with a dedicated camera, and capturing
 * the rendered texture — so prefab / model / mesh thumbnails carry real materials
 * and lighting, unlike the CPU flat-shade fallback. One job at a time, driven from
 * a `postUpdate` system; the result is an {@link ImTextureRef} the asset browser
 * shows. A job that can't become ready within a frame budget is abandoned (the
 * browser keeps the CPU thumbnail). All work is wrapped so a failure never breaks
 * the editor frame.
 */
export class ThumbnailRenderService {
  private readonly cache = new Map<string, ImTextureRef>();
  private readonly failed = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly queue: { guid: string; kind: string }[] = [];
  private readonly textures: Texture[] = [];
  private job: Job | null = null;
  private camera: Entity | null = null;

  constructor(
    private readonly app: App,
    private readonly renderer: Renderer,
  ) {}

  /**
   * The rendered preview for an asset, or `undefined` while it renders / when it
   * was abandoned (the caller then shows its own fallback). Enqueues on first miss.
   */
  get(guid: string, kind: string): ImTextureRef | undefined {
    const hit = this.cache.get(guid);
    if (hit !== undefined) return hit;
    if (this.failed.has(guid) || this.queued.has(guid)) return undefined;
    this.queued.add(guid);
    this.queue.push({ guid, kind });
    return undefined;
  }

  /** Drop a cached render so the next {@link get} re-renders it (asset bytes changed). */
  invalidate(guid: string): void {
    this.cache.delete(guid);
    this.failed.delete(guid);
    this.queued.delete(guid);
  }

  /** Advance the render job state machine. Call from a `postUpdate` system with `Commands`. */
  tick(cmd: CommandsHandle): void {
    try {
      this.step(cmd);
    } catch (err) {
      console.warn('[studio] thumbnail render failed', err);
      this.abort(cmd);
    }
  }

  private step(cmd: CommandsHandle): void {
    if (this.job === null) {
      const next = this.queue.shift();
      if (next === undefined) {
        this.setCameraActive(false);
        return;
      }
      this.start(cmd, next.guid, next.kind);
      return;
    }
    if (this.job.phase === 'loading') this.stepLoading(cmd);
    else this.stepSettle(cmd);
  }

  private start(cmd: CommandsHandle, guid: string, kind: string): void {
    const server = this.app.getResource(AssetServer);
    const instance = server !== undefined ? makeInstanceComponent(kind, server.loadByGuid(guid as never)) : undefined;
    if (server === undefined || instance === undefined) {
      this.failed.add(guid);
      this.queued.delete(guid);
      return;
    }
    const texture = this.renderer.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
      label: `thumb-render-${guid}`,
    });
    const parts: object[] = [new Name('(thumbnail)'), stagedTransform(), new EditorOnly(), instance];
    if (kind === 'Mesh') {
      const matReg = this.app.getResource(AppTypeRegistry)?.registry.get('MeshMaterial3d<StandardMaterial>');
      if (matReg !== undefined) parts.push(matReg.make());
    }
    const root = cmd.spawn(...parts).id;
    this.ensureCamera(cmd, texture);
    this.job = { guid, kind, texture, root, phase: 'loading', frames: 0, lastRadius: -1, stableFrames: 0 };
  }

  private stepLoading(cmd: CommandsHandle): void {
    const job = this.job!;
    job.frames += 1;
    // Keep the whole staged subtree out of the hierarchy + saves while it exists.
    this.hideSubtree(cmd, job.root);
    const aabb = this.instanceBounds(job.root);
    if (aabb !== null) {
      // The instance streams in over several frames (reactor expansion + async
      // mesh loads), so its world bounds keep growing. Wait until they hold steady
      // before framing — otherwise the camera frames a half-loaded box.
      const radius = radiusOf(aabb);
      const settled = Math.abs(radius - job.lastRadius) <= job.lastRadius * 0.02 + 1e-3;
      job.stableFrames = settled ? job.stableFrames + 1 : 0;
      job.lastRadius = radius;
      if (job.frames >= MIN_LOAD_FRAMES && job.stableFrames >= 3) {
        this.frameCamera(aabb);
        const c = aabb.center;
        console.log(
          `[studio] thumbnail ${job.guid} (${job.kind}): radius=${radius.toFixed(2)} center=[${(c[0] ?? 0).toFixed(0)},${(c[1] ?? 0).toFixed(0)},${(c[2] ?? 0).toFixed(0)}]`,
        );
        job.phase = 'settle';
        job.frames = 0;
        return;
      }
    }
    if (job.frames > LOAD_BUDGET) {
      console.warn(`[studio] thumbnail ${job.guid}: gave up (no stable mesh bounds)`);
      this.failed.add(job.guid);
      this.abort(cmd);
    }
  }

  private stepSettle(cmd: CommandsHandle): void {
    const job = this.job!;
    job.frames += 1;
    if (job.frames < SETTLE_FRAMES) return;
    // The camera has rendered the framed asset into `texture`; freeze it by
    // registering it for ImGui and parking the camera (idle cameras don't render).
    this.cache.set(job.guid, ImGuiImplWeb.RegisterTexture((job.texture as InternalTexture)[GPU_TEXTURE]));
    this.textures.push(job.texture);
    if (this.app.world.hasEntity(job.root)) cmd.entity(job.root).despawn();
    this.setCameraActive(false);
    this.job = null;
  }

  /** Tag the staged instance's whole subtree EditorOnly so it never shows in the hierarchy or a save. */
  private hideSubtree(cmd: CommandsHandle, root: Entity): void {
    const world = this.app.world;
    const stack: Entity[] = [root];
    const seen = new Set<Entity>();
    while (stack.length > 0) {
      const entity = stack.pop()!;
      if (seen.has(entity)) continue;
      seen.add(entity);
      if (!world.has(entity, EditorOnly)) cmd.entity(entity).insert(new EditorOnly());
      const children = world.getComponent(entity, Children);
      if (children !== undefined) for (const c of children.entities) if (world.hasEntity(c)) stack.push(c);
    }
  }

  private abort(cmd: CommandsHandle): void {
    if (this.job !== null) {
      this.queued.delete(this.job.guid);
      if (this.app.world.hasEntity(this.job.root)) cmd.entity(this.job.root).despawn();
      this.job.texture.destroy();
      this.job = null;
    }
    this.setCameraActive(false);
  }

  // ---- camera ----

  private ensureCamera(cmd: CommandsHandle, texture: Texture): void {
    if (this.camera !== null && this.app.world.hasEntity(this.camera)) {
      const cam = this.app.world.getComponent(this.camera, Camera);
      if (cam !== undefined) {
        cam.target = CameraRenderTarget.texture(texture);
        cam.isActive = true;
      }
      return;
    }
    this.camera = cmd.spawn(
      ...Camera3d({
        hdr: false,
        order: 50,
        target: CameraRenderTarget.texture(texture),
        clearColor: ClearColorConfig.custom({ r: 0.07, g: 0.09, b: 0.1, a: 1 }),
        // Wide far plane so a large asset (or a transient over-sized bound) is
        // never clipped; framing distance is in view space, so the staging
        // offset doesn't affect it.
        projection: { fov: FOV, near: 0.05, far: 2_000_000 },
        transform: stagedTransform(),
      }),
      new EditorOnly(),
    ).id;
  }

  private setCameraActive(active: boolean): void {
    if (this.camera === null) return;
    const cam = this.app.world.getComponent(this.camera, Camera);
    if (cam !== undefined) cam.isActive = active;
  }

  private frameCamera(aabb: Aabb): void {
    if (this.camera === null) return;
    const transform = this.app.world.getComponent(this.camera, Transform);
    if (transform === undefined) return;
    const radius =
      Math.max(aabb.halfExtents[0] ?? 0, aabb.halfExtents[1] ?? 0, aabb.halfExtents[2] ?? 0) || 0.5;
    const distance = (radius / Math.tan(FOV / 2)) * 1.5;
    const center = aabb.center;
    const eye = vec3.create(
      (center[0] ?? 0) + VIEW_DIR[0]! * distance,
      (center[1] ?? 0) + VIEW_DIR[1]! * distance,
      (center[2] ?? 0) + VIEW_DIR[2]! * distance,
    );
    const view = mat4.lookAt(eye, center, vec3.create(0, 1, 0));
    const rotation = quat.fromMat(mat4.inverse(view), quat.create());
    transform.translation[0] = eye[0]!;
    transform.translation[1] = eye[1]!;
    transform.translation[2] = eye[2]!;
    transform.rotation[0] = rotation[0]!;
    transform.rotation[1] = rotation[1]!;
    transform.rotation[2] = rotation[2]!;
    transform.rotation[3] = rotation[3]!;
    this.app.world.markChanged(this.camera, Transform);
  }

  /**
   * World-space bounds of the instance's loaded meshes, or `null` when none have
   * loaded yet (the reactor hasn't expanded it / assets are still streaming).
   */
  private instanceBounds(root: Entity): Aabb | null {
    const world = this.app.world;
    const meshes = this.app.getResource(Meshes);
    if (meshes === undefined) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    const local = new Aabb();
    const stack: Entity[] = [root];
    const seen = new Set<Entity>();
    while (stack.length > 0) {
      const entity = stack.pop()!;
      if (seen.has(entity)) continue;
      seen.add(entity);
      const mesh3d = world.getComponent(entity, Mesh3d);
      const global = world.getComponent(entity, GlobalTransform);
      if (mesh3d !== undefined && global !== undefined) {
        const mesh = meshes.get(mesh3d.handle);
        if (mesh !== undefined) {
          Aabb.transform(mesh.computeAabb(local), global.matrix, local);
          minX = Math.min(minX, local.center[0]! - local.halfExtents[0]!);
          minY = Math.min(minY, local.center[1]! - local.halfExtents[1]!);
          minZ = Math.min(minZ, local.center[2]! - local.halfExtents[2]!);
          maxX = Math.max(maxX, local.center[0]! + local.halfExtents[0]!);
          maxY = Math.max(maxY, local.center[1]! + local.halfExtents[1]!);
          maxZ = Math.max(maxZ, local.center[2]! + local.halfExtents[2]!);
        }
      }
      const children = world.getComponent(entity, Children);
      if (children !== undefined) for (const c of children.entities) if (world.hasEntity(c)) stack.push(c);
    }
    if (minX > maxX) return null;
    return Aabb.fromMinMax(vec3.create(minX, minY, minZ), vec3.create(maxX, maxY, maxZ));
  }
}
