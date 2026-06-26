import type { AssetImporter, AssetSerializer } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';
import { quat, vec3 } from '@retro-engine/math';

import type { HumanoidSlot } from './humanoid';
import type { RetargetSlot } from './retarget-rig';
import { RetargetRig } from './retarget-rig';

/** The {@link Assets} store holding built/imported {@link RetargetRig}s. */
export class RetargetRigs extends Assets<RetargetRig> {}

/** Asset-kind tag and file extension for {@link RetargetRig}. */
export const RETARGET_RIG_ASSET_KIND = 'RetargetRig';

/** Current `.rerig` wire-format version. Bumped only on a breaking shape change. */
export const RETARGET_RIG_FORMAT_VERSION = 2;

interface RetargetSlotFile {
  readonly slot: HumanoidSlot;
  readonly boneId: string;
  readonly restT: readonly [number, number, number];
  readonly restR: readonly [number, number, number, number];
  readonly restS: readonly [number, number, number];
  readonly restWorldT: readonly [number, number, number];
  readonly restWorldR: readonly [number, number, number, number];
  readonly parentRestWorldR: readonly [number, number, number, number];
}

interface RetargetRigFile {
  readonly version: number;
  readonly name?: string;
  readonly slots: readonly RetargetSlotFile[];
}

const encodeRig = (rig: RetargetRig): Uint8Array => {
  const file: RetargetRigFile = {
    version: RETARGET_RIG_FORMAT_VERSION,
    ...(rig.name !== undefined ? { name: rig.name } : {}),
    slots: rig.slots.map((s) => ({
      slot: s.slot,
      boneId: s.boneId,
      restT: [s.restT[0]!, s.restT[1]!, s.restT[2]!],
      restR: [s.restR[0]!, s.restR[1]!, s.restR[2]!, s.restR[3]!],
      restS: [s.restS[0]!, s.restS[1]!, s.restS[2]!],
      restWorldT: [s.restWorldT[0]!, s.restWorldT[1]!, s.restWorldT[2]!],
      restWorldR: [s.restWorldR[0]!, s.restWorldR[1]!, s.restWorldR[2]!, s.restWorldR[3]!],
      parentRestWorldR: [
        s.parentRestWorldR[0]!,
        s.parentRestWorldR[1]!,
        s.parentRestWorldR[2]!,
        s.parentRestWorldR[3]!,
      ],
    })),
  };
  return new TextEncoder().encode(JSON.stringify(file));
};

const decodeRig = (bytes: Uint8Array): RetargetRig => {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RetargetRigFile>;
  if (raw.version !== RETARGET_RIG_FORMAT_VERSION) {
    throw new Error(
      `RetargetRig: unsupported format version ${String(raw.version)} (expected ${RETARGET_RIG_FORMAT_VERSION})`,
    );
  }
  if (!Array.isArray(raw.slots)) {
    throw new Error('RetargetRig: payload is missing a slots array');
  }
  const slots: RetargetSlot[] = raw.slots.map((s) => ({
    slot: s.slot,
    boneId: s.boneId,
    restT: vec3.create(s.restT[0], s.restT[1], s.restT[2]),
    restR: quat.create(s.restR[0], s.restR[1], s.restR[2], s.restR[3]),
    restS: vec3.create(s.restS[0], s.restS[1], s.restS[2]),
    restWorldT: vec3.create(s.restWorldT[0], s.restWorldT[1], s.restWorldT[2]),
    restWorldR: quat.create(s.restWorldR[0], s.restWorldR[1], s.restWorldR[2], s.restWorldR[3]),
    parentRestWorldR: quat.create(
      s.parentRestWorldR[0],
      s.parentRestWorldR[1],
      s.parentRestWorldR[2],
      s.parentRestWorldR[3],
    ),
  }));
  return new RetargetRig(slots, raw.name);
};

/**
 * Build the {@link AssetImporter} that turns `.rerig` bytes (UTF-8 JSON) into a
 * {@link RetargetRig}. Synchronous — a rig description is self-contained.
 */
export const createRetargetRigImporter = (): AssetImporter<RetargetRig> => (bytes) => decodeRig(bytes);

/**
 * Build the {@link AssetSerializer} that round-trips a {@link RetargetRig} through
 * its canonical `.rerig` JSON form — the inverse of {@link createRetargetRigImporter}.
 */
export const createRetargetRigSerializer = (): AssetSerializer<RetargetRig> => ({
  serialize: (rig) => encodeRig(rig),
  deserialize: (bytes) => decodeRig(bytes),
});
