import { TypeRegistry } from '@retro-engine/reflect';

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
}
