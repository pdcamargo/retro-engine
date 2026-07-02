// Pure, in-place mutations on an AnimationController — the domain edits the
// Animator UI and the `animController.*` MCP commands both drive. The controller
// is the source of truth (ADR-0143); the derived GraphDocument is rebuilt after a
// structural change. Types are deeply readonly, so an edit replaces the touched
// array element with a fresh object rather than mutating fields; the arrays
// themselves (`parameters`/`states`/`transitions`/`layers`) are mutable.
//
// State deletion is the one edit with cross-references: transitions index states
// by position, so removing a state drops its incident transitions and shifts every
// higher index (and the default state) down. Covered by ac-ops.test.ts.

import { asAssetIndex, type Handle, makeHandle } from '@retro-engine/assets';
import type {
  AnimationClip,
  AnimationController,
  AvatarMask,
  ConditionOp,
  ControllerLayer,
  ControllerParameter,
  ControllerState,
  Motion,
  ParameterType,
  Transition,
  TransitionCondition,
} from '@retro-engine/engine';

// ---- Parameters ------------------------------------------------------------

/** A parameter's default when freshly created or re-typed: 0 for float/trigger, 0 (false) for bool. */
export const defaultForType = (type: ParameterType): number => (type === 'bool' ? 0 : 0);

/** Append a parameter with a name unique among existing parameters. */
export const addParameter = (c: AnimationController, type: ParameterType = 'float'): ControllerParameter => {
  const base = type === 'float' ? 'Float' : type === 'bool' ? 'Bool' : 'Trigger';
  const name = uniqueName(base, c.parameters.map((p) => p.name));
  const param: ControllerParameter = { name, type, default: defaultForType(type) };
  c.parameters.push(param);
  return param;
};

/** Rename a parameter and repoint every condition / blend-tree reference to the new name. */
export const renameParameter = (c: AnimationController, index: number, name: string): void => {
  const param = c.parameters[index];
  if (param === undefined || name === '' || name === param.name) return;
  const unique = uniqueName(name, c.parameters.filter((_, i) => i !== index).map((p) => p.name));
  const old = param.name;
  c.parameters[index] = { ...param, name: unique };
  // Repoint transition conditions.
  c.transitions = c.transitions.map((t) => ({
    ...t,
    conditions: t.conditions.map((cond) => (cond.parameter === old ? { ...cond, parameter: unique } : cond)),
  }));
  // Repoint blend-tree driving parameters throughout every state's motion.
  c.states = c.states.map((s) => ({ ...s, motion: repointMotionParam(s.motion, old, unique) }));
};

/** Change a parameter's type, resetting its default (a retype re-scopes valid operators). */
export const retypeParameter = (c: AnimationController, index: number, type: ParameterType): void => {
  const param = c.parameters[index];
  if (param === undefined || param.type === type) return;
  c.parameters[index] = { ...param, type, default: defaultForType(type) };
};

/** Set a float/bool parameter's default value; a no-op for triggers. */
export const setParameterDefault = (c: AnimationController, index: number, value: number): void => {
  const param = c.parameters[index];
  if (param === undefined || param.type === 'trigger') return;
  c.parameters[index] = { ...param, default: value };
};

/** Remove a parameter by index. Conditions referencing it are left as-is (dangling, editable). */
export const deleteParameter = (c: AnimationController, index: number): void => {
  if (index < 0 || index >= c.parameters.length) return;
  c.parameters.splice(index, 1);
};

// ---- States ----------------------------------------------------------------

/** Append a new clip state with a unique name. Becomes the default when it is the first state. */
export const addState = (c: AnimationController, name?: string): ControllerState => {
  const unique = uniqueName(name ?? 'New State', c.states.map((s) => s.name));
  // A new state starts with an unset clip handle (index 0, no GUID); the user
  // points it at a clip through the inspector.
  const state: ControllerState = { name: unique, motion: { kind: 'clip', clip: makeHandle(asAssetIndex(0)) } };
  c.states.push(state);
  return state;
};

/** Rename a state (unique among states). */
export const renameState = (c: AnimationController, index: number, name: string): void => {
  const state = c.states[index];
  if (state === undefined || name === '' || name === state.name) return;
  c.states[index] = { ...state, name: uniqueName(name, c.states.filter((_, i) => i !== index).map((s) => s.name)) };
};

/** Set a state's playback speed multiplier (undefined/1 hides the `×speed` tag). */
export const setStateSpeed = (c: AnimationController, index: number, speed: number): void => {
  const state = c.states[index];
  if (state === undefined) return;
  c.states[index] = speed === 1 ? omitSpeed(state) : { ...state, speed };
};

/** Replace a state's motion (clip ↔ blend tree). */
export const setStateMotion = (c: AnimationController, index: number, motion: Motion): void => {
  const state = c.states[index];
  if (state === undefined) return;
  c.states[index] = { ...state, motion };
};

/** Make `index` the default/entry state. */
export const setDefaultState = (c: AnimationController, index: number): void => {
  if (index >= 0 && index < c.states.length) c.defaultState = index;
};

/**
 * Delete a state and repair every index that references it: drop incident
 * transitions (from/to === index), shift higher from/to indices down by one, and
 * fix `defaultState` (clamped; shifts down if it was above the removed state).
 */
export const deleteState = (c: AnimationController, index: number): void => {
  if (index < 0 || index >= c.states.length) return;
  c.states.splice(index, 1);
  c.transitions = c.transitions
    .filter((t) => t.from !== index && t.to !== index)
    .map((t) => ({ ...t, from: shiftIndex(t.from, index), to: shiftIndex(t.to, index) }));
  if (c.defaultState === index) c.defaultState = 0;
  else if (c.defaultState > index) c.defaultState -= 1;
  c.defaultState = Math.max(0, Math.min(c.defaultState, Math.max(0, c.states.length - 1)));
};

// ---- Blend trees -----------------------------------------------------------

/** Return a new motion tree with `fn` applied to the motion at `path` (empty = the root). */
export const updateMotionAtPath = (root: Motion, path: readonly number[], fn: (m: Motion) => Motion): Motion => {
  if (path.length === 0) return fn(root);
  if (root.kind === 'clip') return root;
  const [head, ...rest] = path;
  const children = root.children.map((ch, i) => (i === head ? { ...ch, motion: updateMotionAtPath(ch.motion, rest, fn) } : ch));
  return { ...root, children } as Motion;
};

/** Apply `fn` to the motion at (state, path) and write it back onto the state. */
const editMotionAt = (c: AnimationController, state: number, path: readonly number[], fn: (m: Motion) => Motion): void => {
  const st = c.states[state];
  if (st === undefined) return;
  setStateMotion(c, state, updateMotionAtPath(st.motion, path, fn));
};

const firstFloat = (c: AnimationController): string => c.parameters.find((p) => p.type === 'float')?.name ?? 'speed';
const emptyClip = (): Motion => ({ kind: 'clip', clip: makeHandle(asAssetIndex(0)) });

/** Point a state's (clip) motion at a specific clip handle — the DnD/pick target. */
export const setStateClip = (c: AnimationController, index: number, clip: Handle<AnimationClip>): void => {
  const st = c.states[index];
  if (st === undefined) return;
  setStateMotion(c, index, { kind: 'clip', clip });
};

/** Point a blend child's (clip) motion at a specific clip handle. */
export const setBlendChildClip = (
  c: AnimationController,
  state: number,
  path: readonly number[],
  childIndex: number,
  clip: Handle<AnimationClip>,
): void => {
  editMotionAt(c, state, path, (m) => {
    if (m.kind === 'clip') return m;
    return { ...m, children: m.children.map((ch, i) => (i === childIndex ? { ...ch, motion: { kind: 'clip', clip } } : ch)) } as Motion;
  });
};

/** Replace a state's root motion with a fresh clip / 1D / 2D blend of the chosen kind. */
export const setStateMotionKind = (c: AnimationController, state: number, kind: Motion['kind']): void => {
  const st = c.states[state];
  if (st === undefined || st.motion.kind === kind) return;
  const p = firstFloat(c);
  const motion: Motion =
    kind === 'clip'
      ? emptyClip()
      : kind === 'blend1d'
        ? { kind: 'blend1d', parameter: p, children: [] }
        : { kind: 'blend2d', mode: 'freeformDirectional', parameterX: p, parameterY: p, children: [] };
  setStateMotion(c, state, motion);
};

/** Append a child (a clip leaf, or a nested 1D sub-tree) to the blend at (state, path). */
export const addBlendChild = (c: AnimationController, state: number, path: readonly number[], sub: boolean): void => {
  const childMotion: Motion = sub ? { kind: 'blend1d', parameter: firstFloat(c), children: [] } : emptyClip();
  editMotionAt(c, state, path, (m) => {
    if (m.kind === 'clip') return m;
    if (m.kind === 'blend1d') return { ...m, children: [...m.children, { motion: childMotion, threshold: 0 }] };
    return { ...m, children: [...m.children, { motion: childMotion, x: 0, y: 0 }] };
  });
};

/** Remove child `childIndex` from the blend at (state, path). */
export const removeBlendChild = (c: AnimationController, state: number, path: readonly number[], childIndex: number): void => {
  editMotionAt(c, state, path, (m) => {
    if (m.kind === 'clip') return m;
    return { ...m, children: m.children.filter((_, i) => i !== childIndex) } as Motion;
  });
};

/** Set a 1D child's threshold. */
export const setChildThreshold = (c: AnimationController, state: number, path: readonly number[], childIndex: number, threshold: number): void => {
  editMotionAt(c, state, path, (m) => {
    if (m.kind !== 'blend1d') return m;
    return { ...m, children: m.children.map((ch, i) => (i === childIndex ? { ...ch, threshold } : ch)) };
  });
};

/** Set a 2D child's position. */
export const setChildPosition = (c: AnimationController, state: number, path: readonly number[], childIndex: number, x: number, y: number): void => {
  editMotionAt(c, state, path, (m) => {
    if (m.kind !== 'blend2d') return m;
    return { ...m, children: m.children.map((ch, i) => (i === childIndex ? { ...ch, x, y } : ch)) };
  });
};

/** Set the driving parameter of a 1D blend. */
export const setBlend1dParameter = (c: AnimationController, state: number, path: readonly number[], parameter: string): void => {
  editMotionAt(c, state, path, (m) => (m.kind === 'blend1d' ? { ...m, parameter } : m));
};

/** Set (or clear, when blank) a blend tree's author-facing name. No-op on a clip. */
export const setMotionName = (c: AnimationController, state: number, path: readonly number[], name: string): void => {
  const trimmed = name.trim();
  editMotionAt(c, state, path, (m) => (m.kind === 'clip' ? m : ({ ...m, name: trimmed === '' ? undefined : trimmed } as Motion)));
};

/** Set the X / Y driving parameters of a 2D blend. */
export const setBlend2dParameters = (c: AnimationController, state: number, path: readonly number[], parameterX: string, parameterY: string): void => {
  editMotionAt(c, state, path, (m) => (m.kind === 'blend2d' ? { ...m, parameterX, parameterY } : m));
};

/** Set the algorithm of a 2D blend. */
export const setBlend2dMode = (c: AnimationController, state: number, path: readonly number[], mode: import('@retro-engine/engine').Blend2dMode): void => {
  editMotionAt(c, state, path, (m) => (m.kind === 'blend2d' ? { ...m, mode } : m));
};

// ---- Transitions -----------------------------------------------------------

/** Create a transition `from → to` (`from === -1` for an Any-State transition). Returns its index. */
export const addTransition = (c: AnimationController, from: number, to: number): number => {
  const t: Transition = { from, to, conditions: [], duration: 0.15, hasExitTime: false, exitTime: 0 };
  c.transitions.push(t);
  return c.transitions.length - 1;
};

/** Remove a transition by index. */
export const deleteTransition = (c: AnimationController, index: number): void => {
  if (index >= 0 && index < c.transitions.length) c.transitions.splice(index, 1);
};

/** Patch scalar fields (duration / exit time) on a transition. */
export const setTransitionField = (
  c: AnimationController,
  index: number,
  patch: Partial<Pick<Transition, 'duration' | 'hasExitTime' | 'exitTime'>>,
): void => {
  const t = c.transitions[index];
  if (t === undefined) return;
  c.transitions[index] = { ...t, ...patch };
};

/** Append a condition to a transition; defaults the operator to the parameter's type. */
export const addCondition = (c: AnimationController, index: number, parameter: string): void => {
  const t = c.transitions[index];
  if (t === undefined) return;
  const type = c.parameters.find((p) => p.name === parameter)?.type ?? 'float';
  const op: ConditionOp = type === 'trigger' ? 'trigger' : type === 'bool' ? 'eq' : 'gt';
  const value = type === 'bool' ? 1 : 0;
  c.transitions[index] = { ...t, conditions: [...t.conditions, { parameter, op, value }] };
};

/** Replace one condition on a transition. */
export const setCondition = (
  c: AnimationController,
  index: number,
  condIndex: number,
  cond: TransitionCondition,
): void => {
  const t = c.transitions[index];
  if (t === undefined || condIndex < 0 || condIndex >= t.conditions.length) return;
  const conditions = t.conditions.slice();
  conditions[condIndex] = cond;
  c.transitions[index] = { ...t, conditions };
};

/** Remove one condition from a transition. */
export const deleteCondition = (c: AnimationController, index: number, condIndex: number): void => {
  const t = c.transitions[index];
  if (t === undefined || condIndex < 0 || condIndex >= t.conditions.length) return;
  c.transitions[index] = { ...t, conditions: t.conditions.filter((_, i) => i !== condIndex) };
};

// ---- Layers ----------------------------------------------------------------

/** Append an override clip layer on top of the stack. */
export const addLayer = (c: AnimationController, name?: string): ControllerLayer => {
  const layer: ControllerLayer = {
    name: uniqueName(name ?? 'New Layer', c.layers.map((l) => l.name)),
    weight: 1,
    blend: 'override',
    source: { kind: 'clip', clip: makeHandle(asAssetIndex(0)), speed: 1, playing: true, repeat: 'loop' },
  };
  c.layers.push(layer);
  return layer;
};

/** Remove a layer by index. */
export const removeLayer = (c: AnimationController, index: number): void => {
  if (index >= 0 && index < c.layers.length) c.layers.splice(index, 1);
};

/** Move a layer up (`-1`) or down (`+1`) in the stack. */
export const moveLayer = (c: AnimationController, index: number, delta: number): number => {
  const to = index + delta;
  if (index < 0 || index >= c.layers.length || to < 0 || to >= c.layers.length) return index;
  const [layer] = c.layers.splice(index, 1);
  c.layers.splice(to, 0, layer!);
  return to;
};

/** Patch a layer's scalar fields (name / weight / blend mode). */
export const setLayerField = (
  c: AnimationController,
  index: number,
  patch: Partial<Pick<ControllerLayer, 'name' | 'weight' | 'blend'>>,
): void => {
  const layer = c.layers[index];
  if (layer === undefined) return;
  c.layers[index] = { ...layer, ...patch };
};

/** Swap a layer's source between a clip and a whole controller (fresh default source). */
export const setLayerSourceKind = (c: AnimationController, index: number, kind: 'clip' | 'controller'): void => {
  const layer = c.layers[index];
  if (layer === undefined || layer.source.kind === kind) return;
  const source: ControllerLayer['source'] =
    kind === 'clip'
      ? { kind: 'clip', clip: makeHandle(asAssetIndex(0)), speed: 1, playing: true, repeat: 'loop' }
      : { kind: 'controller', controller: makeHandle(asAssetIndex(0)), speed: 1, playing: true, parameters: [] };
  c.layers[index] = { ...layer, source };
};

/** Set (or clear) a layer's avatar-mask reference. */
export const setLayerMask = (c: AnimationController, index: number, mask: Handle<AvatarMask> | undefined): void => {
  const layer = c.layers[index];
  if (layer === undefined) return;
  const next = { ...layer };
  if (mask === undefined) delete next.mask;
  else next.mask = mask;
  c.layers[index] = next;
};

/** Point a clip-source layer at a clip handle. */
export const setLayerClip = (c: AnimationController, index: number, clip: Handle<AnimationClip>): void => {
  const layer = c.layers[index];
  if (layer === undefined || layer.source.kind !== 'clip') return;
  c.layers[index] = { ...layer, source: { ...layer.source, clip } };
};

// ---- helpers ---------------------------------------------------------------

const shiftIndex = (i: number, removed: number): number => (i > removed ? i - 1 : i);

const omitSpeed = (state: ControllerState): ControllerState => {
  const { speed: _speed, ...rest } = state;
  return rest;
};

/** Deep-replace a blend node's driving parameter name(s) after a parameter rename. */
const repointMotionParam = (motion: Motion, from: string, to: string): Motion => {
  if (motion.kind === 'clip') return motion;
  if (motion.kind === 'blend1d') {
    return {
      ...motion,
      parameter: motion.parameter === from ? to : motion.parameter,
      children: motion.children.map((ch) => ({ ...ch, motion: repointMotionParam(ch.motion, from, to) })),
    };
  }
  return {
    ...motion,
    parameterX: motion.parameterX === from ? to : motion.parameterX,
    parameterY: motion.parameterY === from ? to : motion.parameterY,
    children: motion.children.map((ch) => ({ ...ch, motion: repointMotionParam(ch.motion, from, to) })),
  };
};

/** Make `base` unique against `existing` by appending ` 2`, ` 3`, … when taken. */
export const uniqueName = (base: string, existing: readonly string[]): string => {
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
};
