import type { Entity } from '@retro-engine/ecs';
import type {
  App,
  ChildBuilder,
  CommandsHandle,
  EntityCommands,
  Handle,
  MeshMaterial3d,
  StandardMaterial,
} from '@retro-engine/engine';
import {
  Children,
  Commands,
  Mesh3d,
  Name,
  Parent,
  PendingAttachment,
  Query,
  Res,
  Transform,
} from '@retro-engine/engine';
import { quat, vec3 } from '@retro-engine/math';

import { GLTF_NODE_ANCHOR_KIND } from './gltf-attach';
import { gltfAnchorForEntity } from './gltf-anchor';
import { GltfInstanceNodes, GltfSceneRoot } from './gltf-components';
import type { Gltf } from './gltf-root';
import { Gltfs } from './gltf-root';

/** Constructor for the StandardMaterial-typed `MeshMaterial3d` subclass to attach. */
type MeshMaterialCtor = new (handle: Handle<StandardMaterial>) => MeshMaterial3d<StandardMaterial>;

/** A fresh `Transform` copying a node's TRS — the asset's own is never aliased onto an entity. */
const cloneTransform = (t: Transform): Transform =>
  new Transform(
    vec3.clone(t.translation, vec3.create()),
    quat.clone(t.rotation, quat.create()),
    vec3.clone(t.scale, vec3.create()),
  );

/**
 * Spawn one glTF node as a child of `parent`, recording its entity by index and
 * name, then recurse into its children. A single-primitive mesh node carries
 * its `Mesh3d` + `MeshMaterial3d` directly; a multi-primitive node is a
 * transform/name anchor with one child entity per primitive. Entity ids are
 * reserved synchronously by `spawn`, so the index/name maps are complete before
 * the command flush.
 */
const spawnNode = (
  parent: ChildBuilder,
  nodeIndex: number,
  gltf: Gltf,
  nodeEntities: (Entity | undefined)[],
  byName: Map<string, Entity[]>,
  meshMaterialCtor: MeshMaterialCtor,
): void => {
  const node = gltf.nodes[nodeIndex];
  if (node === undefined) return;

  const mesh = node.mesh !== undefined ? gltf.meshes[node.mesh] : undefined;
  const components: object[] = [cloneTransform(node.transform)];
  if (node.name !== undefined) components.push(new Name(node.name));
  if (mesh !== undefined && mesh.primitives.length === 1) {
    const prim = mesh.primitives[0]!;
    components.push(new Mesh3d(prim.mesh));
    if (prim.material !== undefined) components.push(new meshMaterialCtor(prim.material));
  }

  const ec = parent.spawn(...components);
  const entity = ec.id;
  nodeEntities[nodeIndex] = entity;
  if (node.name !== undefined) {
    const list = byName.get(node.name);
    if (list !== undefined) list.push(entity);
    else byName.set(node.name, [entity]);
  }

  if (mesh !== undefined && mesh.primitives.length > 1) {
    ec.withChildren((pb) => {
      for (const prim of mesh.primitives) {
        const primComponents: object[] = [new Mesh3d(prim.mesh)];
        if (prim.material !== undefined) primComponents.push(new meshMaterialCtor(prim.material));
        pb.spawn(...primComponents);
      }
    });
  }

  if (node.children.length > 0) {
    ec.withChildren((cb) => {
      for (const childIndex of node.children) {
        spawnNode(cb, childIndex, gltf, nodeEntities, byName, meshMaterialCtor);
      }
    });
  }
};

/** Instantiate one resolved root's chosen scene under `rootEntity` and record the result. */
const instantiateRoot = (
  cmd: CommandsHandle,
  rootEntity: Entity,
  root: GltfSceneRoot,
  gltf: Gltf,
  meshMaterialCtor: MeshMaterialCtor,
): void => {
  const scene = root.scene !== undefined ? gltf.scenes[root.scene] : gltf.defaultScene;
  const nodeEntities = Array.from<Entity | undefined>({ length: gltf.nodes.length }).fill(undefined);
  const byName = new Map<string, Entity[]>();

  const ec: EntityCommands = cmd.entity(rootEntity);
  if (scene !== undefined) {
    ec.withChildren((b) => {
      for (const nodeIndex of scene.nodes) {
        spawnNode(b, nodeIndex, gltf, nodeEntities, byName, meshMaterialCtor);
      }
    });
  }
  // Recorded even for an empty/absent scene, so the root drops out of the
  // pending query and is not re-polled every frame. The source handle index +
  // scene let the re-instantiation system detect a later model swap.
  ec.insert(new GltfInstanceNodes(nodeEntities, byName, root.handle.index as number, root.scene));
};

/**
 * Register the glTF instantiation reactor on `app`. Each frame it scans
 * {@link GltfSceneRoot} entities not yet instantiated, polls the {@link Gltfs}
 * store for the handle's value (the same store-presence idiom asset prepare
 * systems use — there is no asset-ready event), and on readiness spawns the
 * scene's node graph as a child subtree, recording a {@link GltfInstanceNodes}.
 * Runs in `update` so `postUpdate` transform propagation reaches the new
 * entities the same frame. `meshMaterialCtor` is the StandardMaterial-typed
 * `MeshMaterial3d` subclass the renderer's material plugin queries for.
 */
export const addGltfInstantiation = (app: App, meshMaterialCtor: MeshMaterialCtor): void => {
  app.addSystem(
    'update',
    [Commands, Res(Gltfs), Query([GltfSceneRoot], { without: [GltfInstanceNodes] })],
    (cmd, gltfs, roots) => {
      for (const [entity, root] of roots.entries()) {
        const gltf = gltfs.get(root.handle);
        if (gltf === undefined) continue;
        instantiateRoot(cmd, entity, root, gltf, meshMaterialCtor);
      }
    },
    { label: 'gltf-instantiate' },
  );
};

/**
 * Register the re-instantiation reactor: when a {@link GltfSceneRoot}'s handle or
 * scene changes after it has already instantiated, tear down the old node graph
 * and let {@link addGltfInstantiation} rebuild it from the new model — while
 * preserving authored entities attached into the subtree.
 *
 * Each surviving attachment is converted back into a {@link PendingAttachment}
 * (recording the bone anchor it was on) and detached *before* the old subtree is
 * despawned, so the despawn cascade does not consume it; the rebind system
 * re-parents it onto the new model's matching node once that instantiates.
 */
export const addGltfReinstantiation = (app: App): void => {
  app.addSystem(
    'update',
    [Commands, Query([GltfSceneRoot, GltfInstanceNodes], { changed: [GltfSceneRoot] })],
    (cmd, roots) => {
      for (const [mount, root, instance] of roots.entries()) {
        // The `changed` filter also fires on the first frame the root exists;
        // the source comparison is the real gate — a matching handle/scene means
        // nothing to do.
        if (
          (root.handle.index as number) === instance.sourceIndex &&
          root.scene === instance.sourceScene
        ) {
          continue;
        }

        const derived = new Set<Entity>();
        for (const node of instance.nodeEntities) if (node !== undefined) derived.add(node);

        // 1. Detach authored attachments first (order is load-bearing: a despawn
        //    cascade through the bone's Children would otherwise eat them).
        for (const bone of derived) {
          const children = app.world.getComponent(bone, Children);
          if (children === undefined) continue;
          const boneAnchor = gltfAnchorForEntity(app.world, bone);
          if (boneAnchor === undefined) continue;
          // `removeChild` enqueues a command applied at flush, so `entities` is
          // stable across this loop — no snapshot copy needed.
          for (const child of children.entities) {
            if (derived.has(child)) continue; // part of the model — despawned below
            cmd
              .entity(child)
              .insert(new PendingAttachment(mount, GLTF_NODE_ANCHOR_KIND, boneAnchor.anchor));
            cmd.entity(bone).removeChild(child);
          }
        }

        // 2. Despawn the old subtree (top-level nodes cascade through Children).
        for (const bone of derived) {
          if (app.world.getComponent(bone, GltfInstanceNodes) !== undefined) continue;
          const parent = app.world.getComponent(bone, Parent);
          if (parent !== undefined && parent.entity === mount) {
            cmd.entity(bone).despawnRecursive();
          }
        }

        // 3. Drop the record so the one-shot instantiate reactor rebuilds from the
        //    new handle; the rebind system then reattaches the survivors.
        cmd.entity(mount).remove(GltfInstanceNodes);
      }
    },
    { label: 'gltf-reinstantiate' },
  );
};
