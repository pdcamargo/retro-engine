/**
 * Round-trips an asset value of type `T` to and from a byte representation for
 * persistence. Paired `serialize` / `deserialize` so a project asset can be
 * written back after an inspector edit and re-read on the next load.
 */
export interface AssetSerializer<T> {
  /** Encode `value` to bytes for writing to a project asset file. */
  serialize(value: T): Uint8Array;
  /** Decode bytes previously produced by {@link serialize} back into a value. */
  deserialize(bytes: Uint8Array): T;
}

/**
 * Maps an asset-kind tag to its {@link AssetSerializer}. Serializers register
 * through a plugin at startup; a new asset type becomes persistable by
 * registering one, never by extending a base serializer.
 */
export interface AssetSerializerRegistry {
  /** Register `serializer` for the asset-kind tag `kind`. */
  register<T>(kind: string, serializer: AssetSerializer<T>): void;
  /** Look up the serializer registered for `kind`, if any. */
  get<T>(kind: string): AssetSerializer<T> | undefined;
}
