import type { PhysicsBackend, RaycastHit, RaycastQuery } from './backend';
import type { PhysicsCapabilities } from './capabilities';

/**
 * The ECS-facing physics facade, read via `Res(Physics)`. Wraps the active
 * {@link PhysicsBackend} for query access (raycasts, capabilities) without
 * exposing the backend's mutating step API to gameplay systems.
 */
export class Physics {
  constructor(private readonly backend: PhysicsBackend) {}

  /** Optional features the active backend supports. */
  get capabilities(): PhysicsCapabilities {
    return this.backend.capabilities;
  }

  /** Whether the backend has finished initializing (wasm loaded). */
  ready(): boolean {
    return this.backend.ready();
  }

  /** Cast a ray into the world; returns the nearest hit or `null`. */
  raycast(query: RaycastQuery): RaycastHit | null {
    return this.backend.raycast(query);
  }

  /** The active backend, for advanced use / teardown. */
  get backendRef(): PhysicsBackend {
    return this.backend;
  }
}
