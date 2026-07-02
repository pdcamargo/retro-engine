// On-disk lifecycle for Animation Controller assets from the studio: mint a new
// `.ranimctrl` on disk, open an existing one into the Animator session, and save
// the open controller back. Mirrors the material create/persist flow in main.ts
// (createAsset → reindex → fill the store slot this frame).

import type { AssetGuid, Handle } from '@retro-engine/assets';
import type { AssetSink } from '@retro-engine/assets';
import {
  type App,
  AnimationController,
  ANIMATION_CONTROLLER_ASSET_KIND,
  AssetSerializers,
  AssetServer,
  AVATAR_MASK_ASSET_KIND,
  AvatarMask,
  createAsset,
  saveAsset,
} from '@retro-engine/engine';

import { extractStateLayout } from './ac-codec';
import { type AnimatorSession, openController, rebuildSession } from './animator-session';

/** What the on-disk helpers need from the studio: the app, the project sink, and a reindex. */
export interface AcAssetDeps {
  readonly app: App;
  readonly session: AnimatorSession;
  readonly sink: AssetSink;
  readonly reindex: () => Promise<void>;
}

const CONTROLLER_EXTENSION = 'ranimctrl';

/** A fresh, empty controller: no parameters, no states (the editor authors them). */
export const newAnimationController = (name: string): AnimationController =>
  new AnimationController([], [], [], 0, name);

/**
 * Create a new `.ranimctrl` on disk under `dir`, reindex so it loads by GUID, fill
 * its store slot this frame, and open it in the Animator. Returns the new GUID.
 */
export const createControllerAsset = async (
  deps: AcAssetDeps,
  dir: string,
  name: string,
): Promise<string | undefined> => {
  const server = deps.app.getResource(AssetServer);
  const serializers = deps.app.getResource(AssetSerializers);
  if (server === undefined || serializers === undefined) return undefined;
  const serializer = serializers.get(ANIMATION_CONTROLLER_ASSET_KIND);
  if (serializer === undefined) return undefined;

  const value = newAnimationController(name);
  const created = await createAsset(value, ANIMATION_CONTROLLER_ASSET_KIND, serializer, deps.sink, {
    dir,
    extension: CONTROLLER_EXTENSION,
  });
  await deps.reindex();
  const handle = server.loadByGuid(created.guid);
  const resolved = server.storeForGuid(created.guid);
  if (resolved !== undefined) resolved.store.insert(handle, value);
  openController(deps.session, value, created.guid, null);
  deps.session.location = created.location;
  return created.guid;
};

/**
 * Open an existing controller by GUID into the Animator. If its value is already
 * in the store it opens immediately; otherwise the load is kicked off and the
 * session records a pending open that {@link tickPendingOpen} completes.
 */
export const openControllerByGuid = (deps: AcAssetDeps, guid: string, location: string): void => {
  const server = deps.app.getResource(AssetServer);
  if (server === undefined) return;
  const handle = server.loadByGuid(guid as AssetGuid);
  const resolved = server.storeForGuid(guid as AssetGuid);
  const value = resolved?.store.get(handle);
  if (value instanceof AnimationController) {
    openController(deps.session, value, guid, null);
    deps.session.location = location;
    return;
  }
  deps.session.pendingOpen = { guid, location };
};

/**
 * Complete a pending open once its controller value has loaded. Called each frame
 * by the Animator panel; a no-op when nothing is pending or not yet loaded.
 */
export const tickPendingOpen = (deps: AcAssetDeps): void => {
  const pending = deps.session.pendingOpen;
  if (pending === undefined) return;
  const server = deps.app.getResource(AssetServer);
  const resolved = server?.storeForGuid(pending.guid as AssetGuid);
  const value = resolved?.store.get(resolved.handle);
  if (value instanceof AnimationController) {
    openController(deps.session, value, pending.guid, null);
    deps.session.location = pending.location;
    deps.session.pendingOpen = undefined;
  }
};

// Manifest paths for masks minted this session, so a later save knows where to
// write (saveAsset needs the location, which the create step is the source of).
const maskLocations = new Map<string, string>();

/** Mint a new empty `.ramask` on disk, fill its store slot, and return its handle. */
export const createMaskAsset = async (deps: AcAssetDeps, name: string): Promise<Handle<AvatarMask> | undefined> => {
  const server = deps.app.getResource(AssetServer);
  const serializers = deps.app.getResource(AssetSerializers);
  const serializer = serializers?.get(AVATAR_MASK_ASSET_KIND);
  if (server === undefined || serializer === undefined) return undefined;
  const value = new AvatarMask([], name);
  const created = await createAsset(value, AVATAR_MASK_ASSET_KIND, serializer, deps.sink, { dir: 'assets', extension: 'ramask' });
  await deps.reindex();
  const handle = server.loadByGuid(created.guid);
  const resolved = server.storeForGuid(created.guid);
  if (resolved !== undefined) resolved.store.insert(handle, value);
  maskLocations.set(created.guid, created.location);
  return handle as Handle<AvatarMask>;
};

/** Persist a mask asset (edited in the mask editor) back to its `.ramask`. */
export const saveMaskAsset = async (deps: AcAssetDeps, handle: Handle<AvatarMask>): Promise<boolean> => {
  const guid = handle.guid;
  const location = guid !== undefined ? maskLocations.get(guid) : undefined;
  if (guid === undefined || location === undefined) return false;
  return saveAsset(deps.app, guid as AssetGuid, AVATAR_MASK_ASSET_KIND, location, deps.sink);
};

/** Persist the open controller back to its `.ranimctrl`, keeping layout in sync. */
export const saveOpenController = async (deps: AcAssetDeps): Promise<boolean> => {
  const { session } = deps;
  if (session.controller === null || session.guid === null || session.location === null) return false;
  // Refresh the layout side-table from the current node positions before saving so
  // a rebuild after save restores the user's arrangement.
  const doc = session.host.get(session.guid);
  if (doc !== undefined) session.layout = extractStateLayout(doc, session.controller);
  rebuildSession(session);
  return saveAsset(deps.app, session.guid as AssetGuid, ANIMATION_CONTROLLER_ASSET_KIND, session.location, deps.sink);
};
