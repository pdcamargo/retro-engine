import type { Entity } from '@retro-engine/ecs';
import type {
  BodyReadback,
  BodySnapshot,
  CharacterConfig,
  CharacterMovement,
  CollisionEvent,
  JointDesc,
  PhysicsBackend,
  PhysicsCapabilities,
  PhysicsDimension,
  RaycastHit,
  RaycastQuery,
} from '@retro-engine/physics-core';

import { Rapier2dWorld } from './world-2d';
import { Rapier3dWorld } from './world-3d';

const CAPABILITIES: PhysicsCapabilities = {
  dimensions2d: true,
  dimensions3d: true,
  continuousCollisionDetection: true,
  joints: false,
  characterController: true,
  raycast: true,
  shapecast: false,
};

/**
 * A {@link PhysicsBackend} over Rapier, handling both 2D
 * (`@dimforge/rapier2d-compat`) and 3D (`rapier3d-compat`) worlds. Each
 * snapshot/query is routed to the world for its `dimension`; the two worlds are
 * independent (an entity lives in exactly one). Created via
 * {@link createRapierBackend} and injected into `PhysicsPlugin`.
 */
class RapierBackend implements PhysicsBackend {
  readonly capabilities: PhysicsCapabilities = CAPABILITIES;

  private readonly world2d = new Rapier2dWorld();
  private readonly world3d = new Rapier3dWorld();

  async init(): Promise<void> {
    await Promise.all([this.world2d.init(), this.world3d.init()]);
  }

  ready(): boolean {
    return this.world2d.ready() && this.world3d.ready();
  }

  setGravity(dimension: PhysicsDimension, gravity: readonly number[]): void {
    if (dimension === '2d') this.world2d.setGravity(gravity);
    else this.world3d.setGravity(gravity);
  }

  upsertBody(entity: Entity, snapshot: BodySnapshot): void {
    if (snapshot.dimension === '2d') this.world2d.upsertBody(entity, snapshot);
    else this.world3d.upsertBody(entity, snapshot);
  }

  removeBody(entity: Entity): void {
    // An entity lives in one world; removing from both is safe (each no-ops if absent).
    this.world2d.removeBody(entity);
    this.world3d.removeBody(entity);
  }

  step(dt: number): void {
    this.world2d.step(dt);
    this.world3d.step(dt);
  }

  readBody(entity: Entity): BodyReadback | undefined {
    return this.world2d.readBody(entity) ?? this.world3d.readBody(entity);
  }

  drainCollisionEvents(): readonly CollisionEvent[] {
    const a = this.world2d.drainCollisionEvents();
    const b = this.world3d.drainCollisionEvents();
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    return [...a, ...b];
  }

  raycast(query: RaycastQuery): RaycastHit | null {
    return query.dimension === '2d' ? this.world2d.raycast(query) : this.world3d.raycast(query);
  }

  moveCharacter(entity: Entity, config: CharacterConfig, desired: readonly number[]): CharacterMovement | null {
    return config.dimension === '2d'
      ? this.world2d.moveCharacter(entity, config, desired)
      : this.world3d.moveCharacter(entity, config, desired);
  }

  upsertJoint(owner: Entity, desc: JointDesc): void {
    if (desc.dimension === '2d') this.world2d.upsertJoint(owner, desc);
    else this.world3d.upsertJoint(owner, desc);
  }

  removeJoint(owner: Entity): void {
    // The owner lives in one world; removing from both is safe (no-ops if absent).
    this.world2d.removeJoint(owner);
    this.world3d.removeJoint(owner);
  }

  destroy(): void {
    this.world2d.destroy();
    this.world3d.destroy();
  }
}

/**
 * Create a Rapier physics backend supporting both 2D and 3D. Pass to
 * `PhysicsPlugin`: `new PhysicsPlugin({ backend: createRapierBackend() })`. Both
 * wasm modules load asynchronously on `init()`; the bridge skips stepping until
 * `ready()`.
 */
export const createRapierBackend = (): PhysicsBackend => new RapierBackend();
