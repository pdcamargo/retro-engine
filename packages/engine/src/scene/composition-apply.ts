import type { Entity } from '@retro-engine/ecs';
import type { AssetGuid } from '@retro-engine/assets';
import type { DecodeEnv } from '@retro-engine/reflect';
import { decodeComponent } from '@retro-engine/reflect';

import { AssetServer } from '../asset/asset-server';
import { AssetStores } from '../asset/asset-stores';
import { Commands } from '../commands';
import type { App } from '../index';
import { applyFieldOverrides } from '../prefab/template-params';
import { Query } from '../system-param';

import { AppTypeRegistry } from './app-type-registry';
import { buildDecodeEnv } from './deserialize';
import {
  CompositionResolverRegistry,
  PendingAttachment,
  PendingCompositionOverrides,
} from './composition';

/** No scene-id remap is available a frame after load, so anchored override fields decode against an empty map. */
const NO_ENTITY_REMAP = new Map<number, Entity>();

/**
 * Register the generic system that re-applies a loaded scene's derived-subtree
 * overrides. It waits (retrying each frame) until every anchor `kind` on a mount
 * reports its subtree instantiated, then resolves each anchor through the
 * {@link CompositionResolverRegistry} and applies the recorded deltas — `deleted`
 * despawns the node (re-homing any authored attachment that targeted it),
 * `remove` drops components, `add` inserts whole components (so their required
 * components resolve), and `set` overlays the changed fields onto the live
 * component. The mount's {@link PendingCompositionOverrides} is removed once done.
 *
 * Labelled `composition-override-apply` so a plugin's rebind system (e.g. glTF
 * attachment rebind) can order itself `after` it — deletions then run before an
 * attachment is parented onto a node that is about to disappear.
 */
export const addCompositionOverrideApply = (app: App): void => {
  app.addSystem(
    'update',
    [Commands, Query([PendingCompositionOverrides]), Query([PendingAttachment])],
    (cmd, pendingOverrides, pendingAttachments) => {
      const resolvers = app.getResource(CompositionResolverRegistry);
      if (resolvers === undefined) return;
      const registry = app.getResource(AppTypeRegistry)!.registry;

      const server = app.getResource(AssetServer);
      const stores = app.getResource(AssetStores);
      const env: DecodeEnv = buildDecodeEnv(registry, NO_ENTITY_REMAP, {
        resolveHandle: (assetType, guid) => {
          if (server !== undefined && server.hasGuid(guid as AssetGuid)) {
            return server.loadByGuid(guid as AssetGuid);
          }
          if (stores !== undefined) return stores.handleFor(assetType, guid);
          throw new Error(
            `composition override: cannot resolve asset '${guid}' (type '${assetType}')`,
          );
        },
      });

      for (const [mount, pending] of pendingOverrides.entries()) {
        // Defer the whole mount until every kind's subtree is instantiated, so a
        // partially-built model never gets half its overrides applied.
        let ready = true;
        for (const ov of pending.overrides) {
          const resolver = resolvers.get(ov.kind);
          if (resolver !== undefined && !resolver.instantiated(app.world, mount)) {
            ready = false;
            break;
          }
        }
        if (!ready) continue;

        for (const ov of pending.overrides) {
          const resolver = resolvers.get(ov.kind);
          if (resolver === undefined) {
            app.logger.devWarn(
              `composition override: no resolver for kind '${ov.kind}' on mount ${String(mount)} — dropping override`,
            );
            continue;
          }
          const target = resolver.resolve(app.world, mount, ov.anchor);
          if (target === undefined) {
            app.logger.devWarn(
              `composition override: could not resolve anchor on mount ${String(mount)} — dropping override`,
            );
            continue;
          }

          if (ov.deleted === true) {
            // Re-home any authored attachment that targeted this node so deleting
            // the node does not silently take the user's attached entity with it.
            for (const [child, att] of pendingAttachments.entries()) {
              if (att.to !== mount) continue;
              if (resolver.resolve(app.world, mount, att.anchor) !== target) continue;
              cmd.entity(mount).addChild(child);
              cmd.entity(child).remove(PendingAttachment);
            }
            cmd.entity(target).despawnRecursive();
            continue;
          }

          if (ov.add !== undefined) {
            for (const component of ov.add) {
              const reg = registry.get(component.type);
              if (reg === undefined) continue;
              cmd.entity(target).insert(decodeComponent(reg, component, env));
            }
          }

          if (ov.remove !== undefined) {
            for (const type of ov.remove) {
              const reg = registry.get(type);
              if (reg !== undefined) cmd.entity(target).remove(reg.ctor);
            }
          }

          if (ov.set !== undefined) {
            for (const patch of ov.set) {
              const reg = registry.get(patch.type);
              if (reg === undefined) continue;
              const instance = (app.world.getComponent(target, reg.ctor) ?? reg.make()) as Record<
                string,
                unknown
              >;
              applyFieldOverrides(reg, instance, patch.data, env);
              // Re-insert so change detection fires (e.g. transform propagation re-runs).
              cmd.entity(target).insert(instance);
            }
          }
        }

        cmd.entity(mount).remove(PendingCompositionOverrides);
      }
    },
    { label: 'composition-override-apply' },
  );
};
