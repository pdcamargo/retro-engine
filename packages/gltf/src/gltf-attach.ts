import type { App, CompositionProvider } from '@retro-engine/engine';
import { Commands, CompositionRegistry, PendingAttachment, Query } from '@retro-engine/engine';

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
      for (const node of instance.nodeEntities) if (node !== undefined) yield node;
    }
  },
  anchorFor(world, derived) {
    const info = gltfAnchorForEntity(world, derived);
    if (info === undefined) return undefined;
    return { mount: info.mount, kind: GLTF_NODE_ANCHOR_KIND, anchor: info.anchor };
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
    { label: 'gltf-attach-rebind' },
  );
};
