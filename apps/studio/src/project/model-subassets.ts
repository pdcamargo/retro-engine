import type { AssetGuid } from '@retro-engine/assets';
import type { AnimationClip, App, Handle } from '@retro-engine/engine';
import { AnimationClips, AssetServer, subAssetGuid } from '@retro-engine/engine';
import { type Gltf, Gltfs } from '@retro-engine/gltf';

import type { BrowserAsset } from './project-browser';

/**
 * Resolves a model asset's derived children — its meshes, materials, and
 * animation clips — into {@link BrowserAsset}s the asset browser can show and
 * (for clips) assign.
 *
 * A model's children live inside the binary, not in the static `.meta` scan, so
 * they are enumerated lazily: the first request for a model kicks an idempotent
 * load through the {@link AssetServer}; once the decoded {@link Gltf} root is in
 * its store (a frame or two later) the children are built once and cached. Until
 * then the model reports no children. Each child's GUID is the deterministic
 * sub-asset reference `"<modelGuid>#<label>"`, matching the labels the glTF
 * importer emits, so a saved reference to a clip round-trips.
 */
export interface ModelSubAssetService {
  /**
   * The model's derived children, or `undefined` while the model is still
   * loading. Returns `undefined` for non-model assets. Kicks the load on first
   * call, so invoking it for every visible model each frame is how enumeration
   * makes progress.
   */
  subsFor(model: BrowserAsset): readonly BrowserAsset[] | undefined;
}

const childAsset = (
  name: string,
  type: BrowserAsset['type'],
  parentGuid: string,
  label: string,
  location: string,
  kind: string,
): BrowserAsset => ({
  name,
  type,
  guid: subAssetGuid(parentGuid as AssetGuid, label),
  location,
  meta: kind,
  thumbnailable: false,
});

/** Build the derived-child list from a decoded {@link Gltf} root. */
const buildSubs = (
  model: BrowserAsset,
  gltf: Gltf,
  clips: AnimationClips | undefined,
): BrowserAsset[] => {
  const subs: BrowserAsset[] = [];

  gltf.animationClips.forEach((handle: Handle<AnimationClip>, i) => {
    const label = `Animation${i}`;
    const name = clips?.get(handle)?.name ?? '';
    subs.push(childAsset(name || label, 'animation', model.guid, label, model.location, 'AnimationClip'));
  });

  gltf.meshes.forEach((mesh, i) => {
    // Display granularity is one tile per glTF mesh; the sub-ref points at its
    // first primitive (the importer labels primitives `Mesh{i}/Primitive{j}`).
    subs.push(
      childAsset(mesh.name ?? `Mesh ${i}`, 'mesh', model.guid, `Mesh${i}/Primitive0`, model.location, 'Mesh'),
    );
  });

  const materialName = new Map<number, string>();
  for (const [name, handle] of gltf.namedMaterials) materialName.set(handle.index, name);
  gltf.materials.forEach((handle, i) => {
    subs.push(
      childAsset(
        materialName.get(handle.index) ?? `Material ${i}`,
        'material',
        model.guid,
        `Material${i}`,
        model.location,
        'StandardMaterial',
      ),
    );
  });

  return subs;
};

/** Create the service backed by an `App`'s asset stores. */
export const createModelSubAssetService = (app: App): ModelSubAssetService => {
  const cache = new Map<string, readonly BrowserAsset[]>();
  const handles = new Map<string, Handle<Gltf>>();

  return {
    subsFor(model) {
      if (model.type !== 'model') return undefined;
      const cached = cache.get(model.guid);
      if (cached !== undefined) return cached;

      const server = app.getResource(AssetServer);
      const gltfs = app.getResource(Gltfs);
      const clips = app.getResource(AnimationClips);
      if (server === undefined || gltfs === undefined) return undefined;

      let handle = handles.get(model.guid);
      if (handle === undefined) {
        handle = server.loadByGuid<Gltf>(model.guid as AssetGuid);
        handles.set(model.guid, handle);
      }
      const gltf = gltfs.get(handle);
      if (gltf === undefined) return undefined; // still loading

      const subs = buildSubs(model, gltf, clips);
      cache.set(model.guid, subs);
      return subs;
    },
  };
};
