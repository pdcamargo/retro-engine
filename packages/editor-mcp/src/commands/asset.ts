import type { AssetGuid } from '@retro-engine/assets';
import { saveAsset } from '@retro-engine/engine';
import { encodeComponent } from '@retro-engine/reflect';

import { asRecord, reqString } from '../args';
import type { CommandContext } from '../context';
import { type CommandDef, defineCommand } from '../registry';
import { decodeFieldValue, encodeEnvFor, fieldTypeOf } from '../reflect-json';

/** Resolve a loaded asset value (and its store handle) by GUID + kind, kicking a load if needed. */
const resolveAsset = (ctx: CommandContext, guid: string): { value: Record<string, unknown> } | undefined => {
  const server = ctx.assetServer;
  if (server === undefined) throw new Error('mcp: no AssetServer available');
  server.loadByGuid(guid as AssetGuid); // idempotent — ensures the asset is loading
  const resolved = server.storeForGuid(guid as AssetGuid);
  const value = resolved?.store.get(resolved.handle) as Record<string, unknown> | undefined;
  if (value === undefined) return undefined;
  return { value };
};

/**
 * Asset editing: read an asset's fields, set one (undoable + autosaved), and force
 * an immediate save. Mirrors the `component.*` commands but for a stored asset
 * value (e.g. a material) rather than an entity component.
 */
export const assetCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'asset.get',
    title: 'Get asset',
    description:
      'An asset value with its serialized fields, by GUID + kind (e.g. a material: baseColor, roughness, the texture-slot GUIDs). Loads it if needed.',
    domain: 'asset',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string', description: 'the asset GUID (may be a sub-asset ref `<parent>#label`)' },
        kind: { type: 'string', description: 'the asset kind / reflection type, e.g. StandardMaterial' },
      },
      required: ['guid', 'kind'],
    },
    handler: (ctx, args) => {
      const r = asRecord(args);
      const guid = reqString(r, 'guid');
      const kind = reqString(r, 'kind');
      const reg = ctx.registry.get(kind);
      if (reg === undefined) throw new Error(`mcp: unknown asset kind '${kind}'`);
      const resolved = resolveAsset(ctx, guid);
      if (resolved === undefined) return { guid, kind, loaded: false };
      return { guid, kind, loaded: true, fields: encodeComponent(reg, resolved.value, encodeEnvFor(ctx.registry)).data };
    },
  }),
  defineCommand({
    name: 'asset.setField',
    title: 'Set asset field',
    description:
      'Set one top-level field of an asset value (by GUID + kind). The value is decoded into the field type (vectors are number arrays, texture slots take an image GUID). Routes through undo and autosaves to the asset file.',
    domain: 'asset',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string' },
        kind: { type: 'string' },
        field: { type: 'string' },
        value: { description: 'the new field value' },
      },
      required: ['guid', 'kind', 'field', 'value'],
    },
    handler: (ctx, args) => {
      const r = asRecord(args);
      const guid = reqString(r, 'guid');
      const kind = reqString(r, 'kind');
      const field = reqString(r, 'field');
      const resolved = resolveAsset(ctx, guid);
      if (resolved === undefined) throw new Error(`mcp: asset '${guid}' (${kind}) is not loaded`);
      const ft = fieldTypeOf(ctx, kind, field);
      const next = decodeFieldValue(ctx, ft, r.value);
      ctx.history.commitScoped(
        { kind: 'asset', assetKind: kind, guid },
        [{ kind: 'field', name: field }],
        resolved.value[field],
        next,
      );
      return { guid, kind, field };
    },
  }),
  defineCommand({
    name: 'asset.save',
    title: 'Save asset',
    description:
      'Persist an asset to its project file now. Field edits autosave; use this to force an immediate write. Fails for a derived asset (no file of its own).',
    domain: 'asset',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { guid: { type: 'string' }, kind: { type: 'string' } },
      required: ['guid', 'kind'],
    },
    handler: async (ctx, args) => {
      const r = asRecord(args);
      const guid = reqString(r, 'guid');
      const kind = reqString(r, 'kind');
      const io = ctx.projectIo;
      if (io === null) throw new Error('mcp: no project open');
      const location = ctx.assetServer?.locationForGuid(guid as AssetGuid);
      if (location === undefined) throw new Error(`mcp: asset '${guid}' has no project file (a derived asset?)`);
      const saved = await saveAsset(ctx.app, guid as AssetGuid, kind, location, io.sink);
      return { guid, kind, saved, location };
    },
  }),
  defineCommand({
    name: 'asset.create',
    title: 'Create asset',
    description:
      'Create a new authored asset on disk (e.g. an AnimationController) named `name` under `folder`, load it, and return its GUID. Fails for a kind the studio cannot create.',
    domain: 'asset',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'the asset kind, e.g. AnimationController' },
        name: { type: 'string', description: 'the file base name (no extension)' },
        folder: { type: 'string', description: "project-relative folder; defaults to 'assets'" },
      },
      required: ['kind', 'name'],
    },
    handler: async (ctx, args) => {
      const r = asRecord(args);
      const kind = reqString(r, 'kind');
      const name = reqString(r, 'name');
      const folder = typeof r.folder === 'string' && r.folder.length > 0 ? r.folder : 'assets';
      if (ctx.createAsset === undefined) throw new Error('mcp: asset creation is not available (no project open)');
      const guid = await ctx.createAsset(kind, name, folder);
      if (guid === undefined) throw new Error(`mcp: cannot create an asset of kind '${kind}'`);
      const location = ctx.assetServer?.locationForGuid(guid as AssetGuid);
      return { guid, kind, location };
    },
  }),
  defineCommand({
    name: 'asset.rename',
    title: 'Rename asset',
    description:
      "Rename an asset's file and its `.meta` sidecar to a new base name (no extension). The GUID and every reference to it are preserved.",
    domain: 'asset',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string' },
        name: { type: 'string', description: 'the new base name, without extension' },
      },
      required: ['guid', 'name'],
    },
    handler: async (ctx, args) => {
      const r = asRecord(args);
      const guid = reqString(r, 'guid');
      const name = reqString(r, 'name');
      if (ctx.renameAsset === undefined) throw new Error('mcp: asset rename is not available (no project open)');
      await ctx.renameAsset(guid, name);
      const location = ctx.assetServer?.locationForGuid(guid as AssetGuid);
      return { guid, name, location };
    },
  }),
  defineCommand({
    name: 'asset.delete',
    title: 'Delete asset',
    description:
      'Delete an asset: its file, its `.meta` sidecar, and its manifest/registry entry. Any reference to it becomes dangling.',
    domain: 'asset',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { guid: { type: 'string' } },
      required: ['guid'],
    },
    handler: async (ctx, args) => {
      const r = asRecord(args);
      const guid = reqString(r, 'guid');
      if (ctx.deleteAsset === undefined) throw new Error('mcp: asset delete is not available (no project open)');
      await ctx.deleteAsset(guid);
      return { guid, deleted: true };
    },
  }),
];
