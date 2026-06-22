import type { Entity } from '@retro-engine/ecs';

/** Coerce a command's `args` to a plain record (empty when absent / not an object). */
export const asRecord = (args: unknown): Record<string, unknown> => {
  if (typeof args !== 'object' || args === null) return {};
  return args as Record<string, unknown>;
};

/** Required number argument. */
export const reqNumber = (args: Record<string, unknown>, key: string): number => {
  const v = args[key];
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`mcp: '${key}' must be a number`);
  return v;
};

/** Optional number argument. */
export const optNumber = (args: Record<string, unknown>, key: string): number | undefined => {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`mcp: '${key}' must be a number`);
  return v;
};

/** Required string argument. */
export const reqString = (args: Record<string, unknown>, key: string): string => {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`mcp: '${key}' must be a string`);
  return v;
};

/** Optional string argument. */
export const optString = (args: Record<string, unknown>, key: string): string | undefined => {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`mcp: '${key}' must be a string`);
  return v;
};

/** Optional record argument. */
export const optRecord = (args: Record<string, unknown>, key: string): Record<string, unknown> | undefined => {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) throw new Error(`mcp: '${key}' must be an object`);
  return v as Record<string, unknown>;
};

/** Required entity-id argument (a non-negative integer), typed as an {@link Entity}. */
export const reqEntity = (args: Record<string, unknown>, key = 'entity'): Entity => {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error(`mcp: '${key}' must be an entity id (non-negative integer)`);
  }
  return v as unknown as Entity;
};
