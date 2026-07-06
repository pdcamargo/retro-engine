import RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderDesc, EventQueue, RigidBody, RigidBodyDesc, World } from '@dimforge/rapier3d-compat';
import type { Entity } from '@retro-engine/ecs';
import type {
  BodyReadback,
  BodySnapshot,
  CollisionEvent,
  RaycastHit,
  RaycastQuery,
} from '@retro-engine/physics-core';

/**
 * Wraps a Rapier **3D** `World` and the entity↔body maps for it. Owned by
 * {@link RapierBackend}, which routes `dimension === '3d'` snapshots here.
 * Rotation is a quaternion `[x, y, z, w]`; angular velocity is a `[x, y, z]`
 * vector.
 */
export class Rapier3dWorld {
  private world: World | null = null;
  private events: EventQueue | null = null;
  private isReady = false;
  private readonly bodies = new Map<Entity, RigidBody>();
  private readonly colliderEntity = new Map<number, Entity>();
  private readonly gravity = { x: 0, y: -9.81, z: 0 };
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

  setGravity(gravity: readonly number[]): void {
    if (this.world === null) return;
    this.world.gravity.x = gravity[0] ?? 0;
    this.world.gravity.y = gravity[1] ?? 0;
    this.world.gravity.z = gravity[2] ?? 0;
  }

  upsertBody(entity: Entity, snapshot: BodySnapshot): void {
    if (this.world === null) return;
    const existing = this.bodies.get(entity);
    if (existing === undefined) {
      this.createBody(entity, snapshot);
      return;
    }
    existing.setGravityScale(snapshot.gravityScale, false);
    const fx = snapshot.externalForce[0] ?? 0;
    const fy = snapshot.externalForce[1] ?? 0;
    const fz = snapshot.externalForce[2] ?? 0;
    existing.resetForces(false);
    if (fx !== 0 || fy !== 0 || fz !== 0) existing.addForce({ x: fx, y: fy, z: fz }, true);
    if (snapshot.bodyType === 'kinematic') {
      existing.setNextKinematicTranslation({
        x: snapshot.translation[0] ?? 0,
        y: snapshot.translation[1] ?? 0,
        z: snapshot.translation[2] ?? 0,
      });
      existing.setNextKinematicRotation(this.rotationOf(snapshot));
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
    const r = body.rotation();
    const v = body.linvel();
    const a = body.angvel();
    return {
      translation: [t.x, t.y, t.z],
      rotation: [r.x, r.y, r.z, r.w],
      linearVelocity: [v.x, v.y, v.z],
      angularVelocity: [a.x, a.y, a.z],
    };
  }

  drainCollisionEvents(): readonly CollisionEvent[] {
    return this.drained;
  }

  raycast(query: RaycastQuery): RaycastHit | null {
    if (this.world === null) return null;
    const ray = new RAPIER.Ray(
      { x: query.origin[0] ?? 0, y: query.origin[1] ?? 0, z: query.origin[2] ?? 0 },
      { x: query.direction[0] ?? 0, y: query.direction[1] ?? 0, z: query.direction[2] ?? 0 },
    );
    const hit = this.world.castRay(ray, query.maxDistance, true);
    if (hit === null) return null;
    const entity = this.colliderEntity.get(hit.collider.handle);
    if (entity === undefined) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return { entity, distance: hit.timeOfImpact, point: [point.x, point.y, point.z], normal: [0, 0, 0] };
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

  private rotationOf(snapshot: BodySnapshot): { x: number; y: number; z: number; w: number } {
    return {
      x: snapshot.rotation[0] ?? 0,
      y: snapshot.rotation[1] ?? 0,
      z: snapshot.rotation[2] ?? 0,
      w: snapshot.rotation[3] ?? 1,
    };
  }

  private createBody(entity: Entity, snapshot: BodySnapshot): void {
    const world = this.world;
    if (world === null) return;
    const desc = this.bodyDesc(snapshot.bodyType)
      .setTranslation(snapshot.translation[0] ?? 0, snapshot.translation[1] ?? 0, snapshot.translation[2] ?? 0)
      .setRotation(this.rotationOf(snapshot))
      .setGravityScale(snapshot.gravityScale)
      .setLinvel(snapshot.linearVelocity[0] ?? 0, snapshot.linearVelocity[1] ?? 0, snapshot.linearVelocity[2] ?? 0)
      .setAngvel({
        x: snapshot.angularVelocity[0] ?? 0,
        y: snapshot.angularVelocity[1] ?? 0,
        z: snapshot.angularVelocity[2] ?? 0,
      });
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
      case 'cuboid':
        return RAPIER.ColliderDesc.cuboid(
          c.halfExtents[0] ?? 0.5,
          c.halfExtents[1] ?? 0.5,
          c.halfExtents[2] ?? 0.5,
        );
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
