import type {
  BodyReadback,
  BodySnapshot,
  CharacterMovement,
  CollisionEvent,
  PhysicsBackend,
  RaycastHit,
  RaycastQuery,
} from './backend';
import { NULL_PHYSICS_CAPABILITIES, type PhysicsCapabilities } from './capabilities';

const NO_EVENTS: readonly CollisionEvent[] = Object.freeze([]);

/**
 * No-op {@link PhysicsBackend}: nothing simulates. `PhysicsPlugin` installs this
 * when no backend is injected, so worlds that only author physics components —
 * and headless tests — run unchanged. Swap in `@retro-engine/physics-rapier` for
 * real dynamics.
 */
export class NullPhysicsBackend implements PhysicsBackend {
  readonly capabilities: PhysicsCapabilities = NULL_PHYSICS_CAPABILITIES;

  init(): Promise<void> {
    return Promise.resolve();
  }
  ready(): boolean {
    return true;
  }
  setGravity(): void {}
  upsertBody(_entity: unknown, _snapshot: BodySnapshot): void {}
  removeBody(): void {}
  step(): void {}
  readBody(): BodyReadback | undefined {
    return undefined;
  }
  drainCollisionEvents(): readonly CollisionEvent[] {
    return NO_EVENTS;
  }
  raycast(_query: RaycastQuery): RaycastHit | null {
    return null;
  }
  moveCharacter(): CharacterMovement | null {
    return null;
  }
  upsertJoint(): void {}
  removeJoint(): void {}
  destroy(): void {}
}
