import RAPIER from '@dimforge/rapier2d-compat';
import type {
  ColliderDesc,
  EventQueue,
  RigidBody,
  RigidBodyDesc,
  World,
} from '@dimforge/rapier2d-compat';
import type { Entity } from '@retro-engine/ecs';
import type {
  BodyReadback,
  BodySnapshot,
  CollisionEvent,
  PhysicsBackend,
  PhysicsCapabilities,
  PhysicsDimension,
  RaycastHit,
  RaycastQuery,
} from '@retro-engine/physics-core';

const CAPABILITIES: PhysicsCapabilities = {
  dimensions2d: true,
  dimensions3d: false,
  continuousCollisionDetection: true,
  joints: false,
  characterController: false,
  raycast: true,
  shapecast: false,
};

/**
 * A {@link PhysicsBackend} over `@dimforge/rapier2d-compat`. Handles 2D bodies
 * ({@link BodySnapshot} with `dimension === '2d'`); 3D snapshots are ignored
 * (3D arrives with `rapier3d-compat` in a later phase). Created via
 * {@link createRapierBackend} and injected into `PhysicsPlugin`.
 */
class RapierBackend implements PhysicsBackend {
  readonly capabilities: PhysicsCapabilities = CAPABILITIES;

  private world: World | null = null;
  private events: EventQueue | null = null;
  private isReady = false;
  private readonly bodies = new Map<Entity, RigidBody>();
  private readonly colliderEntity = new Map<number, Entity>();
  private readonly gravity = { x: 0, y: -9.81 };
  private drained: CollisionEvent[] = [];

  async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World(this.gravity);
    this.events = new RAPIER.EventQueue(true);
    this.isReady = true;
  }

  ready(): boolean {
    return this.isReady;
  }

  setGravity(dimension: PhysicsDimension, gravity: readonly number[]): void {
    if (dimension !== '2d' || this.world === null) return;
    this.world.gravity.x = gravity[0] ?? 0;
    this.world.gravity.y = gravity[1] ?? 0;
  }

  upsertBody(entity: Entity, snapshot: BodySnapshot): void {
    if (snapshot.dimension !== '2d' || this.world === null) return;
    const existing = this.bodies.get(entity);
    if (existing === undefined) {
      this.createBody(entity, snapshot);
      return;
    }
    // Update per-frame authored inputs; the solver owns a dynamic body's
    // transform/velocity, so those are set only at creation.
    existing.setGravityScale(snapshot.gravityScale, false);
    const [fx, fy] = [snapshot.externalForce[0] ?? 0, snapshot.externalForce[1] ?? 0];
    existing.resetForces(false);
    if (fx !== 0 || fy !== 0) existing.addForce({ x: fx, y: fy }, true);
    if (snapshot.bodyType === 'kinematic') {
      existing.setNextKinematicTranslation({ x: snapshot.translation[0] ?? 0, y: snapshot.translation[1] ?? 0 });
      existing.setNextKinematicRotation(snapshot.rotation[0] ?? 0);
    }
  }

  removeBody(entity: Entity): void {
    const body = this.bodies.get(entity);
    if (body === undefined || this.world === null) return;
    this.world.removeRigidBody(body);
    this.bodies.delete(entity);
    for (const [handle, e] of this.colliderEntity) {
      if (e === entity) this.colliderEntity.delete(handle);
    }
  }

  step(dt: number): void {
    if (this.world === null) return;
    if (dt > 0) this.world.timestep = dt;
    this.world.step(this.events ?? undefined);
    this.drainEvents();
  }

  readBody(entity: Entity): BodyReadback | undefined {
    const body = this.bodies.get(entity);
    if (body === undefined) return undefined;
    const t = body.translation();
    const v = body.linvel();
    return {
      translation: [t.x, t.y],
      rotation: [body.rotation()],
      linearVelocity: [v.x, v.y],
      angularVelocity: [body.angvel()],
    };
  }

  drainCollisionEvents(): readonly CollisionEvent[] {
    return this.drained;
  }

  raycast(query: RaycastQuery): RaycastHit | null {
    if (query.dimension !== '2d' || this.world === null) return null;
    const ray = new RAPIER.Ray(
      { x: query.origin[0] ?? 0, y: query.origin[1] ?? 0 },
      { x: query.direction[0] ?? 0, y: query.direction[1] ?? 0 },
    );
    const hit = this.world.castRay(ray, query.maxDistance, true);
    if (hit === null) return null;
    const entity = this.colliderEntity.get(hit.collider.handle);
    if (entity === undefined) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return { entity, distance: hit.timeOfImpact, point: [point.x, point.y], normal: [0, 0] };
  }

  destroy(): void {
    this.world?.free();
    this.events?.free();
    this.world = null;
    this.events = null;
    this.bodies.clear();
    this.colliderEntity.clear();
    this.isReady = false;
  }

  private createBody(entity: Entity, snapshot: BodySnapshot): void {
    const world = this.world;
    if (world === null) return;
    const desc = this.bodyDesc(snapshot.bodyType)
      .setTranslation(snapshot.translation[0] ?? 0, snapshot.translation[1] ?? 0)
      .setRotation(snapshot.rotation[0] ?? 0)
      .setGravityScale(snapshot.gravityScale)
      .setLinvel(snapshot.linearVelocity[0] ?? 0, snapshot.linearVelocity[1] ?? 0)
      .setAngvel(snapshot.angularVelocity[0] ?? 0);
    const body = world.createRigidBody(desc);
    const colliderDesc = this.colliderDesc(snapshot)
      .setRestitution(snapshot.restitution)
      .setFriction(snapshot.friction)
      .setSensor(snapshot.collider.isSensor);
    const collider = world.createCollider(colliderDesc, body);
    this.bodies.set(entity, body);
    this.colliderEntity.set(collider.handle, entity);
  }

  private bodyDesc(bodyType: BodySnapshot['bodyType']): RigidBodyDesc {
    switch (bodyType) {
      case 'kinematic':
        return RAPIER.RigidBodyDesc.kinematicPositionBased();
      case 'static':
        return RAPIER.RigidBodyDesc.fixed();
      default:
        return RAPIER.RigidBodyDesc.dynamic();
    }
  }

  private colliderDesc(snapshot: BodySnapshot): ColliderDesc {
    const c = snapshot.collider;
    switch (c.shape) {
      case 'rectangle':
        return RAPIER.ColliderDesc.cuboid(c.halfExtents[0] ?? 0.5, c.halfExtents[1] ?? 0.5);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius);
      default:
        return RAPIER.ColliderDesc.ball(c.radius);
    }
  }

  private drainEvents(): void {
    if (this.events === null) return;
    const out: CollisionEvent[] = [];
    this.events.drainCollisionEvents((h1: number, h2: number, started: boolean) => {
      const a = this.colliderEntity.get(h1);
      const b = this.colliderEntity.get(h2);
      if (a !== undefined && b !== undefined) out.push({ kind: started ? 'started' : 'stopped', a, b });
    });
    this.drained = out;
  }
}

/**
 * Create a Rapier 2D physics backend. Pass to `PhysicsPlugin`:
 * `new PhysicsPlugin({ backend: createRapierBackend() })`. The wasm loads
 * asynchronously on `init()`; the bridge skips stepping until `ready()`.
 */
export const createRapierBackend = (): PhysicsBackend => new RapierBackend();
