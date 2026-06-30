import type { AssetGuid, Handle } from '@retro-engine/assets';
import type { Entity, World } from '@retro-engine/ecs';
import type { CustomCommand } from '@retro-engine/editor-sdk';
import {
  Children,
  createAsset,
  createSceneSerializer,
  Mesh3d,
  type Mesh,
  Name,
  Parent,
  PREFAB_ASSET_EXTENSION,
  PREFAB_ASSET_KIND,
  Scene,
  type SceneData,
  SceneRoot,
  serializePrefab,
  Transform,
} from '@retro-engine/engine';
import { type Gltf, GltfSceneRoot } from '@retro-engine/gltf';

import { asRecord, optString, reqEntity, reqString } from '../args';
import { type CommandDef, defineCommand } from '../registry';

/**
 * The linked-instance component for an instantiable asset kind. These markers are
 * transient (not in the reflection registry), so they are constructed directly
 * rather than resolved by name. `undefined` for an un-instantiable kind.
 */
const makeInstanceComponent = (kind: string, handle: Handle<unknown>): object | undefined => {
  if (kind === 'Scene' || kind === 'Prefab') return new SceneRoot(handle as Handle<Scene>);
  if (kind === 'Gltf') return new GltfSceneRoot(handle as Handle<Gltf>);
  if (kind === 'Mesh') return new Mesh3d(handle as Handle<Mesh>);
  return undefined;
};

/**
 * Despawn an entity and its whole subtree directly against the world. A linked
 * instance (SceneRoot / GltfSceneRoot) is expanded by a reactor into child
 * entities under the root; `world.despawn` alone removes only the root and orphans
 * those children (the `Children` cascade runs through the Commands layer, which a
 * History revert does not flush). Walking `Children` post-order removes the lot.
 */
const despawnSubtree = (world: World, root: Entity): void => {
  if (!world.hasEntity(root)) return;
  const children = world.getComponent(root, Children) as { entities: Entity[] } | undefined;
  if (children !== undefined) {
    for (const child of [...children.entities]) despawnSubtree(world, child);
  }
  world.despawn(root);
};

const optVec3 = (record: Record<string, unknown>, key: string): [number, number, number] | undefined => {
  const v = record[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number')) {
    throw new Error(`mcp: '${key}' must be a [x, y, z] number array`);
  }
  return [v[0] as number, v[1] as number, v[2] as number];
};

/** Authoring + instancing of prefabs (Scene-shaped assets, kind `Prefab`). */
export const prefabCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'prefab.createFromEntity',
    title: 'Create prefab from entity',
    description:
      "Serialize an entity and its descendants into a new .prefab asset in the open project (kind 'Prefab'), returning its GUID. The source entity is not changed. Requires an open project.",
    domain: 'prefab',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'integer', description: 'the root entity of the subtree to capture' },
        dir: { type: 'string', description: "target directory (default 'assets/prefabs')" },
      },
      required: ['entity'],
    },
    handler: async (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      if (ctx.projectIo === null) throw new Error('mcp: no project open to write the prefab into');
      const server = ctx.assetServer;
      if (server === undefined) throw new Error('mcp: no AssetServer — cannot register the prefab');

      const data: SceneData = serializePrefab(ctx.app, entity);
      const serializer = createSceneSerializer();
      const dir = optString(record, 'dir') ?? 'assets/prefabs';

      // Name the file after the source entity (not its GUID), deduping with
      // " (1)", " (2)", … against what already exists in the target directory.
      const nameReg = ctx.registry.get('Name');
      const rawName =
        nameReg !== undefined
          ? ((ctx.world.getComponent(entity, nameReg.ctor) as { value?: string } | undefined)?.value ?? '')
          : '';
      const base = rawName.replace(/[/\\:*?"<>|]/g, '').trim() || 'Prefab';
      const source = ctx.projectIo.source;
      const exists = async (loc: string): Promise<boolean> => {
        try {
          await source.read(loc);
          return true;
        } catch {
          return false;
        }
      };
      let basename = base;
      for (let n = 1; await exists(`${dir}/${basename}.${PREFAB_ASSET_EXTENSION}`); n += 1) {
        basename = `${base} (${n})`;
      }

      const created = await createAsset(new Scene(data), PREFAB_ASSET_KIND, serializer, ctx.projectIo.sink, {
        dir,
        extension: PREFAB_ASSET_EXTENSION,
        basename: () => basename,
      });

      // Refresh the manifest + browser so the new asset is discoverable, then fill
      // its store slot from the in-memory copy so it instantiates this frame (the
      // async disk load re-inserts the same value — idempotent).
      await ctx.reindexAssets?.();
      const handle = server.loadByGuid(created.guid);
      const resolved = server.storeForGuid(created.guid);
      if (resolved !== undefined) resolved.store.insert(handle, serializer.deserialize(created.bytes));

      return { guid: created.guid, location: created.location, kind: PREFAB_ASSET_KIND };
    },
  }),
  defineCommand({
    name: 'asset.instantiate',
    title: 'Instantiate asset',
    description:
      'Spawn a linked instance of an asset by GUID: a scene/prefab (SceneRoot), a glTF model (GltfSceneRoot), or a mesh (Mesh3d + a default material). The engine expands the instance. Optionally parent it under an entity and place it at a world position. Undoable.',
    domain: 'asset',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string', description: 'the asset GUID' },
        kind: {
          type: 'string',
          description: "the asset's manifest kind: 'Scene' | 'Prefab' | 'Gltf' | 'Mesh'",
        },
        parent: { type: 'integer', description: 'optional parent entity (omit for a root instance)' },
        position: { type: 'array', description: 'optional world position [x, y, z]' },
        name: { type: 'string', description: 'optional Name for the instance root' },
      },
      required: ['guid', 'kind'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const guid = reqString(record, 'guid');
      const kind = reqString(record, 'kind');
      const server = ctx.assetServer;
      if (server === undefined) throw new Error('mcp: no AssetServer — cannot resolve the asset');
      const parentRaw = record.parent;
      const parent: Entity | null =
        parentRaw === null || parentRaw === undefined ? null : (reqEntity(record, 'parent') as Entity);
      if (parent !== null && !ctx.world.hasEntity(parent)) {
        throw new Error(`mcp: parent ${String(parent)} does not exist`);
      }
      const position = optVec3(record, 'position');
      const name = optString(record, 'name');

      const handle = server.loadByGuid(guid as AssetGuid);
      const instance = makeInstanceComponent(kind, handle);
      if (instance === undefined) throw new Error(`mcp: cannot instantiate asset kind '${kind}'`);
      const id = ctx.world.reserveEntity();
      const build = (): object[] => {
        const t = new Transform();
        if (position !== undefined) {
          t.translation[0] = position[0];
          t.translation[1] = position[1];
          t.translation[2] = position[2];
        }
        const out: object[] = [new Name(name !== undefined && name.length > 0 ? name : kind), t, instance];
        // A bare mesh needs a material to render; attach the default one if present.
        if (kind === 'Mesh') {
          const matReg = ctx.registry.get('MeshMaterial3d<StandardMaterial>');
          if (matReg !== undefined) out.push(matReg.make());
        }
        if (parent !== null) out.push(new Parent(parent));
        return out;
      };
      const cmd: CustomCommand = {
        kind: 'custom',
        entity: id,
        componentName: '',
        label: `Instantiate ${kind}`,
        apply: (world) => {
          world.spawnReserved(id, build());
        },
        // Remove the root AND the reactor-spawned instance subtree (see despawnSubtree).
        revert: (world) => despawnSubtree(world, id),
      };
      ctx.history.apply(cmd);
      ctx.state.selectedEntity = id;
      return { entity: id, guid, kind };
    },
  }),
  defineCommand({
    name: 'material.apply',
    title: 'Apply material to entity',
    description:
      "Point an entity's MeshMaterial3d at a material asset by GUID, adding the component if absent. `materialKind` defaults to 'StandardMaterial'. Undoable.",
    domain: 'material',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'integer' },
        guid: { type: 'string', description: 'the material asset GUID' },
        materialKind: { type: 'string', description: "the material type (default 'StandardMaterial')" },
      },
      required: ['entity', 'guid'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      const guid = reqString(record, 'guid');
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const server = ctx.assetServer;
      if (server === undefined) throw new Error('mcp: no AssetServer — cannot resolve the material');
      const materialKind = optString(record, 'materialKind') ?? 'StandardMaterial';
      const compName = `MeshMaterial3d<${materialKind}>`;
      const reg = ctx.registry.get(compName);
      if (reg === undefined) throw new Error(`mcp: the ${compName} component is not registered`);

      const handle = server.loadByGuid(guid as AssetGuid);
      const path = [{ kind: 'field' as const, name: 'handle' }];
      const existing = ctx.world.getComponent(entity, reg.ctor) as { handle: Handle<unknown> } | undefined;
      if (existing !== undefined) {
        ctx.history.commit(entity, compName, path, existing.handle, handle);
      } else {
        const inst = new (reg.ctor as new (h: Handle<unknown>) => object)(handle);
        ctx.history.apply({ kind: 'addComponent', entity, componentName: compName, after: inst, label: `Apply ${materialKind}` });
      }
      return { entity, guid, materialKind };
    },
  }),
];
