import type { AssetGuid, Handle } from '@retro-engine/assets';
import { parseSubAssetGuid } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import type { AnimationClip, AnimationController, App, Motion, RetargetRig } from '@retro-engine/engine';
import {
  AnimationClips,
  AnimationControllerPlayer,
  AnimationControllers,
  AnimationLayers,
  AnimationPlayer,
  AnimationTarget,
  AssetServer,
  EffectiveClips,
  Query,
  bindRetargetRig,
  buildHumanoidRetargetRig,
  retargetClip,
} from '@retro-engine/engine';

import { GltfInstanceNodes, GltfSceneRoot } from './gltf-components';
import type { Gltf } from './gltf-root';
import { Gltfs } from './gltf-root';
import { buildHumanoidRetargetRigFromGltf } from './retarget-rig-from-gltf';

/** A stable content signature of a target rig: its ordered slot→bone-id mapping. */
const rigSignature = (rig: RetargetRig): string =>
  rig.slots.map((s) => `${s.slot}:${s.boneId}`).join('|');

/**
 * Register the auto-retarget reactor. Each frame it inspects every clip a player
 * can play — an {@link AnimationPlayer}'s clip, an {@link AnimationControllerPlayer}'s
 * controller motions (and blend-tree children), and an {@link AnimationLayers}
 * stack's clip/controller sources. When a clip was authored for a *different*
 * model than the rig it plays on, it retargets the clip to that rig (by bone
 * name) and records the derived clip in {@link EffectiveClips}, so the sampler
 * plays the retargeted form. A clip from the same model is left untouched.
 *
 * The authored clip handle is never rewritten, so a scene saves only the
 * original `"<modelGuid>#AnimationN"` reference; the derived clip is runtime-only
 * and re-derives on every load. Derived clips are cached by
 * `(sourceClipGuid, targetRigSignature)` so every instance of a rig shares one.
 *
 * Runs in `update`, after `gltf-instantiate` (so the target rig's bones exist)
 * and before `animation-sample` (so a freshly bound clip retargets the same
 * frame it would otherwise sample). While the source model is still loading the
 * clip is suppressed rather than sampled raw, so an in-flight load never
 * flickers a wrong pose.
 */
export const addGltfAutoRetarget = (app: App): void => {
  const log = app.logger.child('gltf-auto-retarget');
  // Caches persisted across frames for this app.
  const derivedByKey = new Map<string, Handle<AnimationClip>>();
  const targetRigByPlayer = new Map<Entity, { rig: RetargetRig; sig: string }>();
  const sourceRigByModel = new Map<AssetGuid, RetargetRig | null>();
  const warned = new Set<string>();

  const warnOnce = (key: string, msg: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    log.warn(msg);
  };

  app.addSystem(
    'update',
    [
      Query([AnimationPlayer]),
      Query([AnimationControllerPlayer]),
      Query([AnimationLayers]),
      Query([AnimationTarget]),
    ],
    (players, controllerPlayers, layered, targets) => {
      const server = app.getResource(AssetServer);
      const gltfs = app.getResource(Gltfs);
      const clips = app.getResource(AnimationClips);
      const controllers = app.getResource(AnimationControllers);
      const effective = app.getResource(EffectiveClips);
      if (
        server === undefined ||
        gltfs === undefined ||
        clips === undefined ||
        controllers === undefined ||
        effective === undefined
      ) {
        return;
      }

      // Lazily-built per-player AnimationTarget id sets, only for the fallback
      // path (a rig with no `GltfSceneRoot` origin to compare against).
      let idsByPlayer: Map<Entity, Set<string>> | undefined;
      const targetIdsFor = (player: Entity): Set<string> => {
        if (idsByPlayer === undefined) {
          idsByPlayer = new Map();
          for (const [, target] of targets.entries()) {
            let set = idsByPlayer.get(target.player);
            if (set === undefined) {
              set = new Set();
              idsByPlayer.set(target.player, set);
            }
            set.add(target.id);
          }
        }
        return idsByPlayer.get(player) ?? new Set();
      };

      /**
       * Resolve the effective (retargeted) clip for one authored handle on a
       * player, recording the result in {@link EffectiveClips}. A no-op for a
       * clip native to the rig's model; records `null` (suppress) while the
       * source model loads or when a rig is unmappable.
       */
      const processClip = (player: Entity, authored: Handle<AnimationClip>): void => {
        const guid = authored.guid;
        if (guid === undefined) return; // No persistent identity → treat as native.
        const sub = parseSubAssetGuid(guid);
        if (sub === undefined) return; // A standalone clip has no origin model to retarget from.
        const originModel = sub.parent;

        // Foreign? Prefer the rig's origin model (exact); fall back to whether
        // the clip's track ids name any of the player's existing targets.
        const sceneRoot = app.world.getComponent(player, GltfSceneRoot);
        const rigModel = sceneRoot?.handle.guid;
        let foreign: boolean;
        if (rigModel !== undefined) {
          foreign = rigModel !== originModel;
        } else {
          const ids = targetIdsFor(player);
          const sourceClip = clips.get(authored);
          foreign =
            sourceClip !== undefined &&
            ids.size > 0 &&
            !sourceClip.tracks.some((tr) => ids.has(tr.target.targetId));
        }

        if (!foreign) {
          // Identity entry: the sampler resolves the authored clip unchanged.
          effective.set(player, authored.index, authored);
          return;
        }

        // Foreign. Need the target rig — only once the model has instantiated.
        if (app.world.getComponent(player, GltfInstanceNodes) === undefined) {
          effective.set(player, authored.index, null); // Not ready → suppress.
          return;
        }

        let target = targetRigByPlayer.get(player);
        if (target === undefined) {
          const rig = buildHumanoidRetargetRig(app.world, player);
          if (rig.slot('Hips') === undefined) {
            warnOnce(
              `target:${player}`,
              `entity ${player} has no recognizable humanoid bones; clip ${guid} not retargeted`,
            );
            effective.set(player, authored.index, null);
            return;
          }
          bindRetargetRig(app.world, player, rig);
          target = { rig, sig: rigSignature(rig) };
          targetRigByPlayer.set(player, target);
        }

        const cacheKey = `${guid} ${target.sig}`;
        let derived = derivedByKey.get(cacheKey);
        if (derived === undefined) {
          let sourceRig = sourceRigByModel.get(originModel);
          if (sourceRig === undefined) {
            if (!server.hasGuid(originModel)) {
              warnOnce(
                `model:${originModel}`,
                `source model ${originModel} for clip ${guid} is not in the asset manifest; clip not retargeted`,
              );
              effective.set(player, authored.index, null);
              return;
            }
            const modelHandle = server.loadByGuid<Gltf>(originModel);
            const model = gltfs.get(modelHandle);
            if (model === undefined) {
              effective.set(player, authored.index, null); // Still loading → suppress, retry.
              return;
            }
            const built = buildHumanoidRetargetRigFromGltf(model);
            if (built.slot('Hips') === undefined) {
              warnOnce(
                `model:${originModel}`,
                `source model ${originModel} has no recognizable humanoid bones; clip ${guid} not retargeted`,
              );
              sourceRigByModel.set(originModel, null);
              effective.set(player, authored.index, null);
              return;
            }
            sourceRig = built;
            sourceRigByModel.set(originModel, built);
          }
          if (sourceRig === null) {
            effective.set(player, authored.index, null); // Known-unmappable source.
            return;
          }

          const sourceClip = clips.get(authored);
          if (sourceClip === undefined) {
            effective.set(player, authored.index, null); // Clip not drained yet → retry.
            return;
          }

          const out = retargetClip(sourceClip, sourceRig, target.rig, {
            rootTranslationMode: 'animationScaled',
          });
          derived = clips.add(out);
          derivedByKey.set(cacheKey, derived);
        }

        effective.set(player, authored.index, derived);
      };

      // Gather (player, clip) work first, then process: `processClip` binds the
      // target rig (mutating the world), which must not happen while a query is
      // still iterating. Reading the controller asset here is mutation-free.
      const work: { player: Entity; clip: Handle<AnimationClip> }[] = [];
      const addMotionClips = (motion: Motion, player: Entity): void => {
        if (motion.kind === 'clip') work.push({ player, clip: motion.clip });
        else for (const child of motion.children) addMotionClips(child.motion, player);
      };
      const addControllerClips = (controller: AnimationController, player: Entity): void => {
        for (const state of controller.states) addMotionClips(state.motion, player);
      };

      for (const [player, comp] of players.entries()) {
        work.push({ player, clip: comp.clip });
      }
      for (const [player, comp] of controllerPlayers.entries()) {
        const controller = controllers.get(comp.controller);
        if (controller !== undefined) addControllerClips(controller, player);
      }
      for (const [player, stack] of layered.entries()) {
        for (const layer of stack.layers) {
          const source = layer.source;
          if (source.kind === 'clip') {
            work.push({ player, clip: source.clip });
          } else {
            const controller = controllers.get(source.controller);
            if (controller !== undefined) addControllerClips(controller, player);
          }
        }
      }

      for (const w of work) processClip(w.player, w.clip);
    },
    // After `composition-override-apply` as well as `gltf-instantiate`: the
    // target rig's rest pose is captured from the live bones, which a scene's
    // composition overrides (e.g. an armature re-orientation) may adjust. Capture
    // before the override is applied and the cached rig's reference pose is off,
    // tilting the whole retargeted result.
    {
      label: 'gltf-auto-retarget',
      after: ['gltf-instantiate', 'composition-override-apply'],
      before: ['animation-sample'],
    },
  );
};
