import type { App, CompositionProvider, CompositionResolver } from '@retro-engine/engine';
import {
  Commands,
  CompositionRegistry,
  CompositionResolverRegistry,
  PendingAttachment,
  Query,
} from '@retro-engine/engine';

import { gltfAnchorForEntity, type GltfNodeAnchor, resolveGltfNodeAnchor } from './gltf-anchor';
import { GltfInstanceNodes } from './gltf-components';

/**
 * The `kind` tag for attachments anchored to a glTF node, shared by the
 * serializer's anchor re-emission and the rebind system that resolves it.
 */
export const GLTF_NODE_ANCHOR_KIND = 'gltf-node';

/**
 * Scene serialization's view of instantiated glTF subtrees: which entities are
 * derived (excluded from the save, rebuilt on load) and how an authored entity
 * parented onto a node re-expresses that edge as a stable node anchor.
 *
 * Registered on the {@link CompositionRegistry} so the engine serializer can
 * participate without depending on this package.
 */
const gltfCompositionProvider: CompositionProvider = {
  *excluded(world) {
    for (const entity of world.entities()) {
      const instance = world.getComponent(entity, GltfInstanceNodes);
      if (instance === undefined) continue;
      // Every entity the model produced — node entities and the per-primitive mesh
      // children — is rebuilt on load, so none is serialized as a full entity.
      for (const node of instance.derivedEntities) yield node;
    }
  },
  anchorFor(world, derived) {
    const info = gltfAnchorForEntity(world, derived);
    if (info === undefined) return undefined;
    return { mount: info.mount, kind: GLTF_NODE_ANCHOR_KIND, anchor: info.anchor };
  },
};

/**
 * The load-time resolver for `gltf-node` anchors: a model's subtree is considered
 * instantiated once its mount carries {@link GltfInstanceNodes}, and an anchor
 * resolves through {@link resolveGltfNodeAnchor}. Registered on the
 * {@link CompositionResolverRegistry} so the engine's generic override-apply
 * system can re-express a loaded scene's edits to instantiated nodes.
 */
const gltfNodeResolver: CompositionResolver = {
  instantiated(world, mount) {
    return world.getComponent(mount, GltfInstanceNodes) !== undefined;
  },
  resolve(world, mount, anchor) {
    const instance = world.getComponent(mount, GltfInstanceNodes);
    if (instance === undefined) return undefined;
    return resolveGltfNodeAnchor(world, mount, instance, anchor as GltfNodeAnchor);
  },
};

/**
 * Register glTF attachment round-trip on `app`: the composition provider (so a
 * scene save excludes instantiated nodes and re-emits attachments as anchors)
 * and the rebind system (so a loaded {@link PendingAttachment} is parented onto
 * its resolved node once the model has instantiated).
 *
 * The rebind retries until the mount's {@link GltfInstanceNodes} exists, which is
 * the ordering dependency between authored attachments and glTF instantiation:
 * an attachment loaded before its model simply waits.
 */
export const addGltfAttach = (app: App): void => {
  app.getResource(CompositionRegistry)?.register(gltfCompositionProvider);
  app.getResource(CompositionResolverRegistry)?.register(GLTF_NODE_ANCHOR_KIND, gltfNodeResolver);

  app.addSystem(
    'update',
    [Commands, Query([PendingAttachment])],
    (cmd, pending) => {
      for (const [entity, attach] of pending.entries()) {
        if (attach.kind !== GLTF_NODE_ANCHOR_KIND) continue;
        const instance = app.world.getComponent(attach.to, GltfInstanceNodes);
        if (instance === undefined) continue; // model not instantiated yet — retry next frame

        const bone = resolveGltfNodeAnchor(
          app.world,
          attach.to,
          instance,
          attach.anchor as GltfNodeAnchor,
        );
        if (bone === undefined) {
          app.logger.devWarn(
            `gltf attach: could not resolve node anchor on entity ${String(attach.to)} — dropping attachment for ${String(entity)}`,
          );
          cmd.entity(entity).remove(PendingAttachment);
          continue;
        }
        cmd.entity(bone).addChild(entity);
        cmd.entity(entity).remove(PendingAttachment);
      }
    },
    // After override-apply so a node marked deleted is despawned (and its authored
    // attachments re-homed) before this would parent anything onto it.
    { label: 'gltf-attach-rebind', after: ['composition-override-apply'] },
  );
};
