/**
 * The canonical humanoid skeleton retargeting maps every rig onto. A clip
 * authored for one rig is transferred onto another by matching both rigs'
 * bones to these standardized slots (the "retarget chains"), so motion crosses
 * skeletons that name or proportion their bones differently.
 *
 * This is the shared vocabulary an avatar/rig description ({@link RetargetRig})
 * binds to, and the basis for humanoid body-part masks. It is a fixed code
 * profile, not serialized state.
 */
export type HumanoidSlot =
  | 'Hips'
  | 'Spine'
  | 'Chest'
  | 'UpperChest'
  | 'Neck'
  | 'Head'
  | 'LeftShoulder'
  | 'LeftUpperArm'
  | 'LeftLowerArm'
  | 'LeftHand'
  | 'RightShoulder'
  | 'RightUpperArm'
  | 'RightLowerArm'
  | 'RightHand'
  | 'LeftUpperLeg'
  | 'LeftLowerLeg'
  | 'LeftFoot'
  | 'LeftToes'
  | 'RightUpperLeg'
  | 'RightLowerLeg'
  | 'RightFoot'
  | 'RightToes';

/**
 * Every {@link HumanoidSlot}, in head-to-toe / spine-out order. The order is
 * also root-before-leaf within each chain, which a rest-relative transfer that
 * needs parents resolved first relies on.
 */
export const HUMANOID_SLOTS: readonly HumanoidSlot[] = [
  'Hips',
  'Spine',
  'Chest',
  'UpperChest',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftUpperArm',
  'LeftLowerArm',
  'LeftHand',
  'RightShoulder',
  'RightUpperArm',
  'RightLowerArm',
  'RightHand',
  'LeftUpperLeg',
  'LeftLowerLeg',
  'LeftFoot',
  'LeftToes',
  'RightUpperLeg',
  'RightLowerLeg',
  'RightFoot',
  'RightToes',
];

/** A standardized region of the body, the unit a humanoid body-part mask toggles. */
export type HumanoidBodyPart =
  | 'root'
  | 'torso'
  | 'head'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg';

/**
 * Which {@link HumanoidSlot}s make up each {@link HumanoidBodyPart}. A humanoid
 * body-part mask (head / arms / legs by silhouette) resolves to the union of its
 * parts' slots, then to those slots' bone ids on a concrete rig.
 */
export const HUMANOID_BODY_PARTS: Readonly<Record<HumanoidBodyPart, readonly HumanoidSlot[]>> = {
  root: ['Hips'],
  torso: ['Spine', 'Chest', 'UpperChest'],
  head: ['Neck', 'Head'],
  leftArm: ['LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand'],
  rightArm: ['RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand'],
  leftLeg: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes'],
  rightLeg: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes'],
};

/**
 * Lower-cased bone-name aliases → {@link HumanoidSlot}, used to auto-map a rig
 * by bone names (the equivalent of Unity's "Configure Avatar" auto-detect).
 * Covers the Synty/Polygon naming the engine's sample rigs use plus the common
 * Mixamo names, so most imported humanoids map without hand-editing. Names are
 * matched case-insensitively after stripping a `mixamorig:` / `mixamorig` prefix.
 */
const SLOT_ALIASES: Readonly<Record<string, HumanoidSlot>> = {
  // Synty / Polygon
  hips: 'Hips',
  spine_01: 'Spine',
  spine_02: 'Chest',
  spine_03: 'UpperChest',
  neck: 'Neck',
  head: 'Head',
  clavicle_l: 'LeftShoulder',
  shoulder_l: 'LeftUpperArm',
  elbow_l: 'LeftLowerArm',
  hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder',
  shoulder_r: 'RightUpperArm',
  elbow_r: 'RightLowerArm',
  hand_r: 'RightHand',
  upperleg_l: 'LeftUpperLeg',
  lowerleg_l: 'LeftLowerLeg',
  ankle_l: 'LeftFoot',
  toes_l: 'LeftToes',
  upperleg_r: 'RightUpperLeg',
  lowerleg_r: 'RightLowerLeg',
  ankle_r: 'RightFoot',
  toes_r: 'RightToes',
  // Mixamo
  spine: 'Spine',
  spine1: 'Chest',
  spine2: 'UpperChest',
  leftshoulder: 'LeftShoulder',
  leftarm: 'LeftUpperArm',
  leftforearm: 'LeftLowerArm',
  lefthand: 'LeftHand',
  rightshoulder: 'RightShoulder',
  rightarm: 'RightUpperArm',
  rightforearm: 'RightLowerArm',
  righthand: 'RightHand',
  leftupleg: 'LeftUpperLeg',
  leftleg: 'LeftLowerLeg',
  leftfoot: 'LeftFoot',
  lefttoebase: 'LeftToes',
  rightupleg: 'RightUpperLeg',
  rightleg: 'RightLowerLeg',
  rightfoot: 'RightFoot',
  righttoebase: 'RightToes',
};

/**
 * Resolve a bone name to its {@link HumanoidSlot}, or `undefined` if the name is
 * not a recognized humanoid bone. Case-insensitive; tolerates a `mixamorig:`
 * prefix and Blender's `.001` duplicate suffix.
 */
export const slotForBoneName = (name: string): HumanoidSlot | undefined => {
  let key = name.toLowerCase();
  const colon = key.indexOf(':');
  if (colon >= 0) key = key.slice(colon + 1);
  if (key.startsWith('mixamorig')) key = key.slice('mixamorig'.length).replace(/^[:_]/, '');
  const dot = key.indexOf('.');
  if (dot >= 0) key = key.slice(0, dot);
  return SLOT_ALIASES[key];
};
