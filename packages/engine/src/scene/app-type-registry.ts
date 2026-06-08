import type { ComponentType } from '@retro-engine/ecs';
import { TypeRegistry, type RegisteredType } from '@retro-engine/reflect';

/**
 * The reflection registry an {@link App} serializes and deserializes against,
 * held as an App resource.
 *
 * Each App owns its own registry — plugins populate it from their `build()`
 * (typically via {@link App.registerComponent}), and the scene serializer reads
 * it to turn a live world into data and back. It is deliberately per-App rather
 * than process-wide, so independent Apps (and tests) never see each other's
 * registrations.
 */
export class AppTypeRegistry {
  /** The reflection registry this App serializes/deserializes against. */
  readonly registry: TypeRegistry = new TypeRegistry();

  /**
   * The subset of {@link registry} types that are App resources, keyed by
   * constructor. A resource's schema lives in `registry` like any other type;
   * this map records which of those types the scene serializer should pull off
   * the App (via its resource store) rather than off entities. Populated by
   * `App.registerResource`.
   */
  readonly resources = new Map<ComponentType<object>, RegisteredType>();
}
