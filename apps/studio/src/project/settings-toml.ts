import type { RegisteredType, TypeRegistry } from '@retro-engine/reflect';
import { decodeComponent, encodeComponent } from '@retro-engine/reflect';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

// Settings resources are pure value state — no entity refs, no asset handles —
// so the codec env rejects both rather than carrying scene machinery.
const encodeEnv = (registry: TypeRegistry) => ({
  registry,
  entityId: (): number => {
    throw new Error('settings resources cannot reference entities');
  },
  handleRef: (): string | undefined => undefined,
});

const decodeEnv = (registry: TypeRegistry) => ({
  registry,
  entity: (): never => {
    throw new Error('settings resources cannot reference entities');
  },
  resolveHandle: (): never => {
    throw new Error('settings resources cannot reference asset handles');
  },
});

/**
 * Encode a reflectable settings resource to human-readable TOML — the body of an
 * `editor/settings/<concern>.toml` file. Reuses the reflection codec, so a
 * settings resource round-trips exactly like a serialized scene resource; TOML
 * is only the text encoding.
 */
export const encodeSettingsToml = (
  reg: RegisteredType,
  instance: object,
  registry: TypeRegistry,
): string => {
  const { data } = encodeComponent(reg, instance, encodeEnv(registry));
  return stringifyToml(data as Record<string, unknown>);
};

/** Decode an `editor/settings/<concern>.toml` body back onto a fresh resource instance. */
export const decodeSettingsToml = (reg: RegisteredType, toml: string, registry: TypeRegistry): object => {
  const data = parseToml(toml) as Record<string, unknown>;
  return decodeComponent(reg, { version: reg.version, data }, decodeEnv(registry));
};
