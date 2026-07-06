import RAPIER from '@dimforge/rapier2d-compat';
import type {
  ColliderDesc,
  EventQueue,
  ImpulseJoint,
  KinematicCharacterController,
  RigidBody,
  RigidBodyDesc,
  World,
} from '@dimforge/rapier2d-compat';
import type { Entity } from '@retro-engine/ecs';
import type {
  BodyReadback,
  BodySnapshot,
  CharacterConfig,
  CharacterMovement,
  CollisionEvent,
  JointDesc,
  RaycastHit,
  RaycastQuery,
} from '@retro-engine/physics-core';

/**
 * Wraps a Rapier **2D** `World` and the entity↔body maps for it. Owned by
 * {@link RapierBackend}, which routes `dimension === '2d'` snapshots here.
 * Rotation is a scalar angle; angular velocity is a scalar.
 */
export class Rapier2dWorld {
  private world: World | null = null;
  private events: EventQueue | null = null;
  private isReady = false;
  private readonly bodies = new Map<Entity, RigidBody>();
  private readonly colliderEntity = new Map<number, Entity>();
  private readonly controllers = new Map<Entity, KinematicCharacterController>();
  private readonly joints = new Map<Entity, { joint: ImpulseJoint; target: Entity }>();
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

  setGravity(gravity: readonly number[]): void {
    if (this.world === null) return;
    this.world.gravity.x = gravity[0] ?? 0;
    this.world.gravity.y = gravity[1] ?? 0;
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
    const controller = this.controllers.get(entity);
    if (controller !== undefined) {
      this.world.removeCharacterController(controller);
      this.controllers.delete(entity);
    }
    // Rapier auto-removes joints attached to a removed body, so just drop the
    // map entries (calling removeImpulseJoint again would double-free).
    for (const [owner, rec] of this.joints) {
      if (owner === entity || rec.target === entity) this.joints.delete(owner);
    }
  }

  upsertJoint(owner: Entity, desc: JointDesc): void {
    if (this.world === null || this.joints.has(owner)) return;
    const bodyA = this.bodies.get(owner);
    const bodyB = this.bodies.get(desc.target);
    if (bodyA === undefined || bodyB === undefined) return;
    const a1 = { x: desc.localAnchorA[0] ?? 0, y: desc.localAnchorA[1] ?? 0 };
    const a2 = { x: desc.localAnchorB[0] ?? 0, y: desc.localAnchorB[1] ?? 0 };
    let data;
    switch (desc.type) {
      case 'fixed':
        data = RAPIER.JointData.fixed(a1, 0, a2, 0);
        break;
      case 'prismatic':
        data = RAPIER.JointData.prismatic(a1, a2, { x: desc.axis[0] ?? 1, y: desc.axis[1] ?? 0 });
        break;
      default:
        data = RAPIER.JointData.revolute(a1, a2);
    }
    const joint = this.world.createImpulseJoint(data, bodyA, bodyB, true);
    this.joints.set(owner, { joint, target: desc.target });
  }

  removeJoint(owner: Entity): void {
    const rec = this.joints.get(owner);
    if (rec === undefined || this.world === null) return;
    this.world.removeImpulseJoint(rec.joint, true);
    this.joints.delete(owner);
  }

  moveCharacter(entity: Entity, config: CharacterConfig, desired: readonly number[]): CharacterMovement | null {
    if (this.world === null) return null;
    const body = this.bodies.get(entity);
    if (body === undefined || body.numColliders() === 0) return null;
    let controller = this.controllers.get(entity);
    if (controller === undefined) {
      controller = this.world.createCharacterController(config.offset);
      this.controllers.set(entity, controller);
    }
    controller.setUp({ x: config.up[0] ?? 0, y: config.up[1] ?? 1 });
    controller.setMaxSlopeClimbAngle(config.maxSlopeClimbAngle);
    controller.setMinSlopeSlideAngle(config.minSlopeSlideAngle);
    if (config.autostepHeight > 0) controller.enableAutostep(config.autostepHeight, config.autostepMinWidth, true);
    else controller.disableAutostep();
    if (config.snapToGroundDistance > 0) controller.enableSnapToGround(config.snapToGroundDistance);
    else controller.disableSnapToGround();

    controller.computeColliderMovement(body.collider(0), { x: desired[0] ?? 0, y: desired[1] ?? 0 });
    const m = controller.computedMovement();
    const grounded = controller.computedGrounded();
    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y });
    return { movement: [m.x, m.y], grounded };
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
    if (this.world === null) return null;
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
    this.controllers.clear();
    this.joints.clear();
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
      .setSensor(snapshot.collider.isSensor)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
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
