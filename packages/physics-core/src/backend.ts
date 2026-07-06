import type { Entity } from '@retro-engine/ecs';

import type { PhysicsCapabilities, PhysicsDimension } from './capabilities';
import type { RigidBodyType } from './components-2d';

/** A backend-agnostic description of a collider shape (from a `Collider2d`/`3d`). */
export interface ColliderDesc {
  /** Shape family (`'circle'`/`'rectangle'`/`'capsule'` in 2D; `'sphere'`/`'cuboid'`/`'capsule'` in 3D). */
  readonly shape: string;
  readonly radius: number;
  /** Half-extents `[hx, hy]` (2D) or `[hx, hy, hz]` (3D). */
  readonly halfExtents: readonly number[];
  readonly halfHeight: number;
  readonly isSensor: boolean;
}

/**
 * A plain, ECS-free snapshot of one body's authored state, assembled by the
 * bridge's Sync step and handed to {@link PhysicsBackend.upsertBody}. Vectors are
 * plain number tuples so the backend never touches ECS or math types. Rotation is
 * `[angleRadians]` in 2D and a quaternion `[x, y, z, w]` in 3D; angular velocity
 * is `[w]` in 2D and `[x, y, z]` in 3D.
 */
export interface BodySnapshot {
  readonly dimension: PhysicsDimension;
  readonly bodyType: RigidBodyType;
  readonly translation: readonly number[];
  readonly rotation: readonly number[];
  readonly collider: ColliderDesc;
  readonly linearVelocity: readonly number[];
  readonly angularVelocity: readonly number[];
  readonly externalForce: readonly number[];
  readonly restitution: number;
  readonly friction: number;
  readonly gravityScale: number;
}

/** The simulated state of a body, read by the bridge's Writeback step. */
export interface BodyReadback {
  readonly translation: readonly number[];
  readonly rotation: readonly number[];
  readonly linearVelocity: readonly number[];
  readonly angularVelocity: readonly number[];
}

/**
 * A collision start/stop between two entities. A **class** (not an interface) so
 * it doubles as an ECS message type: `PhysicsPlugin` registers it and writes one
 * per event each fixed step, readable via `MessageReader(CollisionEvent)`.
 * Backends may also produce plain `{ kind, a, b }` objects — structurally
 * assignable, since the class has only public fields.
 */
export class CollisionEvent {
  constructor(
    readonly kind: 'started' | 'stopped',
    readonly a: Entity,
    readonly b: Entity,
  ) {}
}

/** A ray to cast into the world. */
export interface RaycastQuery {
  readonly dimension: PhysicsDimension;
  readonly origin: readonly number[];
  readonly direction: readonly number[];
  readonly maxDistance: number;
}

/** The nearest hit from a {@link RaycastQuery}. */
export interface RaycastHit {
  readonly entity: Entity;
  readonly distance: number;
  readonly point: readonly number[];
  readonly normal: readonly number[];
}

/**
 * The physics solver seam. Implemented by a concrete backend (e.g.
 * `@retro-engine/physics-rapier`) and injected into `PhysicsPlugin`. Speaks only
 * in `Entity` ids and plain data — never ECS query or math types — so a backend
 * stays engine-agnostic and the ECS bridge stays backend-agnostic.
 */
export interface PhysicsBackend {
  /** Optional features this backend supports. */
  readonly capabilities: PhysicsCapabilities;
  /** Async initialization (e.g. loading wasm). Resolves when ready. */
  init(): Promise<void>;
  /** Whether {@link PhysicsBackend.init} has completed — the bridge skips stepping until then. */
  ready(): boolean;
  /** Set world gravity for a dimension. */
  setGravity(dimension: PhysicsDimension, gravity: readonly number[]): void;
  /** Create or update `entity`'s body + collider from a snapshot. */
  upsertBody(entity: Entity, snapshot: BodySnapshot): void;
  /** Remove `entity`'s body. Unknown entities are ignored. */
  removeBody(entity: Entity): void;
  /** Advance the simulation by `dt` seconds. */
  step(dt: number): void;
  /** Read back `entity`'s simulated state, or `undefined` if it has no body. */
  readBody(entity: Entity): BodyReadback | undefined;
  /** Return and clear collision events accumulated since the last drain. */
  drainCollisionEvents(): readonly CollisionEvent[];
  /** Cast a ray and return the nearest hit, or `null`. */
  raycast(query: RaycastQuery): RaycastHit | null;
  /** Release all backend resources. */
  destroy(): void;
}
