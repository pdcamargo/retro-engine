// The Animation Controller's Inspector bodies. The Animator publishes its
// selection (state / transition / parameter / layer / mask / blend node) and the
// shared studio Inspector renders the matching body here — the AC never owns the
// Inspector panel, it only populates it (handoff §2.2). Every edit mutates the
// controller through `ac-ops`, then rebuilds the derived document and persists.

import type { AssetGuid, Handle } from '@retro-engine/assets';
import { Draw, drawIcon, type EditorContext, getActivePalette, srgbU32 } from '@retro-engine/editor-sdk';
import {
  type AnimationClip,
  AnimationClips,
  AnimationTarget,
  AvatarMasks,
  type Blend2dMode,
  type ConditionOp,
  type Motion,
  type ParameterType,
  weights1d,
  weights2d,
} from '@retro-engine/engine';

import type { AcAssetDeps } from './ac-asset';
import { createMaskAsset, saveMaskAsset, saveOpenController } from './ac-asset';
import * as ops from './ac-ops';
import { motionAtPath } from './ac-codec';
import { type AnimatorSession, enterBlendTree, rebuildSession } from './animator-session';

const BLEND2D_MODES: readonly { value: Blend2dMode; label: string }[] = [
  { value: 'simpleDirectional', label: 'Simple Directional' },
  { value: 'freeformCartesian', label: 'Freeform Cartesian' },
  { value: 'freeformDirectional', label: 'Freeform Directional' },
];

/** Preview per-child weights at the parameters' current defaults (a static sample). */
const previewWeights = (c: { parameters: readonly { name: string; default: number }[] }, motion: Motion): Float32Array => {
  if (motion.kind === 'clip') return new Float32Array(0);
  const n = motion.children.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const val = (name: string): number => c.parameters.find((p) => p.name === name)?.default ?? 0;
  if (motion.kind === 'blend1d') {
    weights1d(motion.children.map((ch) => ch.threshold), val(motion.parameter), out);
  } else {
    const pos = new Float32Array(n * 2);
    motion.children.forEach((ch, i) => {
      pos[i * 2] = ch.x;
      pos[i * 2 + 1] = ch.y;
    });
    weights2d(motion.mode, pos, n, val(motion.parameterX), val(motion.parameterY), out);
  }
  return out;
};

const PARAM_TYPES: readonly ParameterType[] = ['float', 'bool', 'trigger'];

/** Float operators (label ↔ op); bool is a subset; trigger is fixed to "is set". */
const FLOAT_OPS: readonly { value: ConditionOp; label: string }[] = [
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'eq', label: '==' },
  { value: 'neq', label: '!=' },
];
const BOOL_OPS = FLOAT_OPS.filter((o) => o.value === 'eq' || o.value === 'neq');

/** Run a controller edit, then rebuild the derived graph + persist to disk. */
const commit = (session: AnimatorSession, deps: AcAssetDeps | null, fn: () => void): void => {
  fn();
  rebuildSession(session);
  if (deps !== null) void saveOpenController(deps);
};

/** Resolve a dropped clip GUID to a handle in the clip store (reserving if unloaded). */
const clipHandleFor = (deps: AcAssetDeps, guid: string): Handle<AnimationClip> | undefined => {
  const clips = deps.app.getResource(AnimationClips);
  if (clips === undefined) return undefined;
  return clips.handleByGuid(guid as AssetGuid) ?? clips.reserveHandle(guid as AssetGuid);
};

/** A clip's display name from the store, or a short GUID, or `undefined` when unset. */
const clipName = (deps: AcAssetDeps | null, handle: Handle<AnimationClip> | undefined): string | undefined => {
  if (handle?.guid === undefined) return undefined;
  const clip = deps?.app.getResource(AnimationClips)?.get(handle);
  return clip?.name ?? `${handle.guid.slice(0, 8)}…`;
};

/**
 * A clip reference slot (à la Unity's object field) that accepts a clip dropped
 * from the Assets browser. Read-only when there is no project (`deps` null).
 */
const clipSlot = (
  ctx: EditorContext,
  deps: AcAssetDeps | null,
  id: string,
  handle: Handle<AnimationClip> | undefined,
  onAssign: (clip: Handle<AnimationClip>) => void,
): void => {
  ctx.widgets.assetField(id, {
    name: clipName(deps, handle),
    type: 'animation',
    expectsLabel: 'AnimationClip',
    readonly: deps === null,
    ...(deps !== null
      ? {
          dnd: {
            target: {
              accepts: (pl) => pl.kind === 'asset' && (pl as { assetType?: string }).assetType === 'animation',
              onDrop: (pl) => {
                const clip = clipHandleFor(deps, (pl as { guid: string }).guid);
                if (clip !== undefined) onAssign(clip);
              },
            },
          },
        }
      : {}),
  });
};

/** The inspector header: an accent icon tile, a small kicker, and the item name. */
const headerBlock = (ctx: EditorContext, icon: string, kicker: string, title: string): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const H = 42;
  const box = 34;
  ui.dummy([ui.contentAvail()[0], H]);
  const iy = top[1] + (H - box) / 2;
  dl.rectFilled([top[0], iy], [top[0] + box, iy + box], srgbU32(p.green400, 0.14), 6);
  drawIcon(icon, [top[0] + (box - 18) / 2, iy + (box - 18) / 2], 18, srgbU32(p.green400));
  dl.textAt([top[0] + box + 12, top[1] + 8], srgbU32(p.textFaint), kicker.toUpperCase(), { size: 9 });
  dl.text([top[0] + box + 12, top[1] + 20], srgbU32(p.text), title);
};

/** A dim, small-caps section divider label with a leading glyph. */
const sectionLabel = (ctx: EditorContext, icon: string, text: string): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  ui.spacing();
  const top = ui.cursorScreenPos();
  ui.dummy([ui.contentAvail()[0], 18]);
  drawIcon(icon, [top[0], top[1] + 2], 12, srgbU32(p.textFaint));
  dl.textAt([top[0] + 18, top[1] + 3], srgbU32(p.textFaint), text.toUpperCase(), { size: 10 });
};

/** A small rounded pill with an icon + label (state chips in the transition header). */
const nodePill = (x: number, y: number, w: number, icon: string, label: string): void => {
  const p = getActivePalette();
  const dl = Draw.window();
  const H = 28;
  dl.rectFilled([x, y], [x + w, y + H], srgbU32(p.gray4), 6);
  dl.rect([x, y], [x + w, y + H], srgbU32(p.gray6), 6, 1);
  drawIcon(icon, [x + 8, y + (H - 13) / 2], 13, srgbU32(p.textMuted));
  dl.text([x + 26, y + (H - 12) / 2], srgbU32(p.text), label);
};

const renderParameterBody = (ctx: EditorContext, session: AnimatorSession, deps: AcAssetDeps | null, index: number): void => {
  const { ui, widgets } = ctx;
  const c = session.controller;
  const param = c?.parameters[index];
  if (c === undefined || c === null || param === undefined) {
    ui.textDisabled('Parameter no longer exists.');
    return;
  }
  headerBlock(ctx, param.type === 'trigger' ? 'zap' : 'circle-dot', 'Parameter', param.name);
  sectionLabel(ctx, 'sliders-horizontal', 'Parameter');
  widgets.inspectorRow('Name', () => {
    const next = ui.inputText('##param-name', param.name, { width: ui.contentAvail()[0] });
    if (next !== param.name) commit(session, deps, () => ops.renameParameter(c, index, next));
  });
  widgets.inspectorRow('Type', () => {
    const active = PARAM_TYPES.indexOf(param.type);
    const picked = widgets.segmented('##param-type', ['Float', 'Bool', 'Trigger'], active);
    if (picked !== active) commit(session, deps, () => ops.retypeParameter(c, index, PARAM_TYPES[picked]!));
  });
  if (param.type === 'float') {
    widgets.inspectorRow('Default', () => {
      const next = widgets.dragNumber('##param-def', param.default, { step: 0.01, width: ui.contentAvail()[0] });
      if (next !== param.default) commit(session, deps, () => ops.setParameterDefault(c, index, next));
    });
  } else if (param.type === 'bool') {
    widgets.inspectorRow('Default', () => {
      const on = widgets.switchToggle('##param-def', param.default >= 0.5);
      if (on !== param.default >= 0.5) commit(session, deps, () => ops.setParameterDefault(c, index, on ? 1 : 0));
    });
  } else {
    widgets.inspectorRow('Default', () => ui.textDisabled('trigger — auto-resets'));
  }

  ui.spacing();
  if (widgets.button('Delete Parameter', { variant: 'danger', size: 'sm', icon: 'trash-2' })) {
    commit(session, deps, () => ops.deleteParameter(c, index));
    session.selection = null;
  }
};

const renderStateBody = (ctx: EditorContext, session: AnimatorSession, deps: AcAssetDeps | null, index: number): void => {
  const { ui, widgets } = ctx;
  const c = session.controller;
  const state = c?.states[index];
  if (c === undefined || c === null || state === undefined) {
    ui.textDisabled('State no longer exists.');
    return;
  }
  const motion = state.motion;
  headerBlock(ctx, motion.kind === 'clip' ? 'file' : 'move', 'State', state.name);

  sectionLabel(ctx, 'sliders-horizontal', 'Properties');
  widgets.inspectorRow('Name', () => {
    const next = ui.inputText('##state-name', state.name, { width: ui.contentAvail()[0] });
    if (next !== state.name) commit(session, deps, () => ops.renameState(c, index, next));
  });
  widgets.inspectorRow('Speed', () => {
    const next = widgets.dragNumber('##state-speed', state.speed ?? 1, { step: 0.01, min: 0, width: 80 });
    if (next !== (state.speed ?? 1)) commit(session, deps, () => ops.setStateSpeed(c, index, next));
    ui.sameLine(0, 8);
    ui.textDisabled('× playback');
  });
  widgets.inspectorRow('Default', () => {
    const isDefault = c.defaultState === index;
    const on = ui.checkbox('Set as entry##state-default', isDefault);
    if (on && !isDefault) commit(session, deps, () => ops.setDefaultState(c, index));
  });

  // Motion: a read-only summary of the state's motion (edited in the blend tree),
  // with a change-type control and, for blends, an Open button.
  sectionLabel(ctx, 'move', 'Motion');
  widgets.inspectorRow('Type', () => {
    const opts = [
      { value: 'clip', label: 'Clip' },
      { value: 'blend1d', label: '1D Blend' },
      { value: 'blend2d', label: '2D Blend' },
    ];
    const picked = widgets.combo('##motion-kind', motion.kind, opts, ui.contentAvail()[0]);
    if (picked !== motion.kind) commit(session, deps, () => ops.setStateMotionKind(c, index, picked as Motion['kind']));
  });
  if (motion.kind === 'clip') {
    widgets.inspectorRow('Clip', () =>
      clipSlot(ctx, deps, `state-clip-${index}`, motion.clip, (h) => commit(session, deps, () => ops.setStateClip(c, index, h))),
    );
  } else {
    if (motion.kind === 'blend2d') {
      widgets.inspectorRow('Algorithm', () => ui.text(BLEND2D_MODES.find((m) => m.value === motion.mode)?.label ?? motion.mode));
      widgets.inspectorRow('Driven by', () => ui.text(`${motion.parameterX} · ${motion.parameterY}`));
    } else {
      widgets.inspectorRow('Driven by', () => ui.text(motion.parameter));
    }
    const nested = motion.children.some((ch) => ch.motion.kind !== 'clip');
    widgets.inspectorRow('Clips', () => ui.textDisabled(`${motion.children.length} children${nested ? ' · has sub-trees' : ''}`));
    ui.spacing();
    if (widgets.button('Open blend tree', { variant: 'primary', size: 'sm', icon: 'git-fork' })) enterBlendTree(session, index, []);
  }

  // Outgoing transitions: jump to one, or add a new one to another state.
  ui.spacing();
  ui.textDisabled('TRANSITIONS');
  c.transitions.forEach((t, ti) => {
    if (t.from !== index) return;
    const target = c.states[t.to]?.name ?? '?';
    if (widgets.button(`${target}##tr-${ti}`, { variant: 'secondary', size: 'sm', icon: 'chevron-right' })) {
      session.selection = { kind: 'transition', index: ti };
    }
  });
  widgets.dropdown(`add-tr-${index}`, 'Add transition', 'plus', () => {
    let any = false;
    c.states.forEach((s, si) => {
      if (si === index) return;
      any = true;
      if (ui.selectable(s.name)) {
        commit(session, deps, () => ops.addTransition(c, index, si));
        ui.closePopup();
      }
    });
    if (!any) ui.textDisabled('No other states');
  });

  ui.spacing();
  if (widgets.button('Delete State', { variant: 'danger', size: 'sm', icon: 'trash-2' })) {
    commit(session, deps, () => ops.deleteState(c, index));
    session.selection = null;
  }
};

/** The Any-State pseudo-node body: author interrupt transitions (from any state). */
const renderAnyStateBody = (ctx: EditorContext, session: AnimatorSession, deps: AcAssetDeps | null): void => {
  const { ui, widgets } = ctx;
  const c = session.controller;
  if (c === null) return;
  headerBlock(ctx, 'shuffle', 'Interrupt source', 'Any State');
  ui.textMuted('Transitions from Any State can fire from whatever state is active.');
  sectionLabel(ctx, 'git-branch', 'Transitions');
  c.transitions.forEach((t, ti) => {
    if (t.from !== -1) return;
    if (widgets.button(`${c.states[t.to]?.name ?? '?'}##anytr-${ti}`, { variant: 'secondary', size: 'sm', icon: 'chevron-right' })) {
      session.selection = { kind: 'transition', index: ti };
    }
  });
  widgets.dropdown('add-any-tr', 'Add transition', 'plus', () => {
    c.states.forEach((s, si) => {
      if (ui.selectable(s.name)) {
        commit(session, deps, () => ops.addTransition(c, -1, si));
        ui.closePopup();
      }
    });
    if (c.states.length === 0) ui.textDisabled('No states');
  });
};

const renderTransitionBody = (ctx: EditorContext, session: AnimatorSession, deps: AcAssetDeps | null, index: number): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const c = session.controller;
  const t = c?.transitions[index];
  if (c === undefined || c === null || t === undefined) {
    ui.textDisabled('Transition no longer exists.');
    return;
  }
  const nameOf = (i: number): string => (i === -1 ? 'Any State' : (c.states[i]?.name ?? '?'));

  // Header: source → target chips.
  const hTop = ui.cursorScreenPos();
  const W = ui.contentAvail()[0];
  const pillW = (W - 30) / 2;
  ui.dummy([W, 28]);
  nodePill(hTop[0], hTop[1], pillW, t.from === -1 ? 'shuffle' : 'circle-dot', nameOf(t.from));
  const ax = hTop[0] + pillW + 8;
  const ay = hTop[1] + 14;
  dl.line([ax, ay], [ax + 12, ay], srgbU32(p.green400), 2);
  dl.triFilled([ax + 12, ay - 4], [ax + 12, ay + 4], [ax + 19, ay], srgbU32(p.green400));
  nodePill(hTop[0] + pillW + 30, hTop[1], pillW, 'circle-dot', nameOf(t.to));

  // Conditions.
  sectionLabel(ctx, 'git-branch', 'Conditions');
  const paramOpts = c.parameters.map((param) => ({ value: param.name, label: param.name }));
  t.conditions.forEach((cond, ci) => {
    const w = ui.contentAvail()[0];
    const type = c.parameters.find((param) => param.name === cond.parameter)?.type ?? 'float';
    const pick = widgets.combo(`##cond-p-${ci}`, cond.parameter, paramOpts, w * 0.44);
    if (pick !== cond.parameter) commit(session, deps, () => ops.setCondition(c, index, ci, { ...cond, parameter: pick }));
    ui.sameLine(0, 4);
    if (type === 'trigger') {
      ui.textDisabled('is set');
    } else {
      const opList = type === 'bool' ? BOOL_OPS : FLOAT_OPS;
      const op = widgets.combo(`##cond-op-${ci}`, cond.op, opList, w * 0.16);
      if (op !== cond.op) commit(session, deps, () => ops.setCondition(c, index, ci, { ...cond, op: op as ConditionOp }));
      ui.sameLine(0, 4);
      if (type === 'bool') {
        const on = widgets.switchToggle(`##cond-v-${ci}`, cond.value >= 0.5);
        if (on !== cond.value >= 0.5) commit(session, deps, () => ops.setCondition(c, index, ci, { ...cond, value: on ? 1 : 0 }));
      } else {
        const v = widgets.dragNumber(`##cond-v-${ci}`, cond.value, { step: 0.01, width: w * 0.2 });
        if (v !== cond.value) commit(session, deps, () => ops.setCondition(c, index, ci, { ...cond, value: v }));
      }
    }
    ui.sameLine(0, 4);
    if (widgets.iconButton(`cond-del-${ci}`, 'x')) commit(session, deps, () => ops.deleteCondition(c, index, ci));
  });
  // Full-width "+ Add condition".
  const abTop = ui.cursorScreenPos();
  const abW = ui.contentAvail()[0];
  const addHit = ui.invisibleButton('add-cond', [abW, 26]);
  const addHov = ui.isItemHovered();
  dl.rect([abTop[0], abTop[1]], [abTop[0] + abW, abTop[1] + 26], srgbU32(addHov ? p.green400 : p.gray6), 4, 1);
  const addLabel = '+ Add condition';
  dl.text([abTop[0] + (abW - ui.calcTextSize(addLabel)[0]) / 2, abTop[1] + 7], srgbU32(addHov ? p.text : p.textMuted), addLabel);
  if (addHit && c.parameters.length > 0) commit(session, deps, () => ops.addCondition(c, index, c.parameters[0]!.name));
  ui.textMuted('Fires when ALL conditions are true.');

  // Timing.
  sectionLabel(ctx, 'clock', 'Timing');
  const bLabels = ui.cursorScreenPos();
  const bw = ui.contentAvail()[0];
  dl.text([bLabels[0], bLabels[1]], srgbU32(p.textMuted), 'source');
  dl.text([bLabels[0] + bw - ui.calcTextSize('target')[0], bLabels[1]], srgbU32(p.textMuted), 'target');
  ui.dummy([bw, 16]);
  const bar = ui.cursorScreenPos();
  const barH = 12;
  dl.rectFilled([bar[0], bar[1]], [bar[0] + bw, bar[1] + barH], srgbU32(p.cyan400, 0.32), 3);
  const xfW = Math.max(10, Math.min(bw, bw * (t.duration / 1)));
  dl.rectFilled([bar[0] + bw - xfW, bar[1]], [bar[0] + bw, bar[1] + barH], srgbU32(p.green400, 0.85), 3);
  ui.dummy([bw, barH]);
  const below = ui.cursorScreenPos();
  dl.text([below[0], below[1]], srgbU32(p.textFaint), t.conditions.length > 0 ? 'condition-gated' : 'immediate');
  const xfLabel = `crossfade ${t.duration.toFixed(2)}s`;
  dl.text([below[0] + bw - ui.calcTextSize(xfLabel)[0], below[1]], srgbU32(p.textFaint), xfLabel);
  ui.dummy([bw, 16]);
  ui.spacing();
  widgets.inspectorRow('Crossfade', () => {
    const next = widgets.slider('##tr-dur', t.duration, { min: 0, max: 2, suffix: 's', width: ui.contentAvail()[0] });
    if (next !== t.duration) commit(session, deps, () => ops.setTransitionField(c, index, { duration: next }));
  });
  widgets.inspectorRow('Exit time', () => {
    const on = widgets.switchToggle('##tr-exit', t.hasExitTime, t.hasExitTime ? 'on' : 'off');
    if (on !== t.hasExitTime) commit(session, deps, () => ops.setTransitionField(c, index, { hasExitTime: on }));
  });
  if (t.hasExitTime) {
    widgets.inspectorRow('At', () => {
      const next = widgets.slider('##tr-exit-at', t.exitTime, { min: 0, max: 1, width: ui.contentAvail()[0] });
      if (next !== t.exitTime) commit(session, deps, () => ops.setTransitionField(c, index, { exitTime: next }));
    });
  }

  ui.spacing();
  if (widgets.button('Delete Transition', { variant: 'danger', size: 'sm', icon: 'trash-2' })) {
    commit(session, deps, () => ops.deleteTransition(c, index));
    session.selection = null;
  }
};

const renderBlendNodeBody = (
  ctx: EditorContext,
  session: AnimatorSession,
  deps: AcAssetDeps | null,
  state: number,
  path: readonly number[],
): void => {
  const { ui, widgets } = ctx;
  const c = session.controller;
  const root = c?.states[state]?.motion;
  const motion = c !== null && root !== undefined ? motionAtPath(root, path) : undefined;
  if (c === null || c === undefined || motion === undefined || motion.kind === 'clip') {
    ui.textDisabled('Blend tree no longer exists.');
    return;
  }
  const typeLabel = motion.kind === 'blend1d' ? '1D Blend Tree' : '2D Blend Tree';
  headerBlock(ctx, 'git-fork', typeLabel, motion.name ?? c.states[state]?.name ?? 'Blend Tree');
  sectionLabel(ctx, 'git-fork', 'Blend Tree');

  // A nested tree can be named so its parent's pins/nodes/breadcrumb read it back.
  if (path.length > 0) {
    widgets.inspectorRow('Name', () => {
      const cur = motion.name ?? '';
      const next = ui.inputText('##bt-name', cur, { width: ui.contentAvail()[0], hint: typeLabel });
      if (next !== cur) commit(session, deps, () => ops.setMotionName(c, state, path, next));
    });
  }

  const floatOpts = c.parameters.filter((param) => param.type === 'float').map((param) => ({ value: param.name, label: param.name }));
  if (motion.kind === 'blend2d') {
    widgets.inspectorRow('Blend Type', () => {
      const next = widgets.combo('##bt-mode', motion.mode, BLEND2D_MODES, ui.contentAvail()[0]);
      if (next !== motion.mode) commit(session, deps, () => ops.setBlend2dMode(c, state, path, next as Blend2dMode));
    });
    widgets.inspectorRow('X param', () => {
      const next = widgets.combo('##bt-px', motion.parameterX, floatOpts, ui.contentAvail()[0]);
      if (next !== motion.parameterX) commit(session, deps, () => ops.setBlend2dParameters(c, state, path, next, motion.parameterY));
    });
    widgets.inspectorRow('Y param', () => {
      const next = widgets.combo('##bt-py', motion.parameterY, floatOpts, ui.contentAvail()[0]);
      if (next !== motion.parameterY) commit(session, deps, () => ops.setBlend2dParameters(c, state, path, motion.parameterX, next));
    });
  } else {
    widgets.inspectorRow('Parameter', () => {
      const next = widgets.combo('##bt-p', motion.parameter, floatOpts, ui.contentAvail()[0]);
      if (next !== motion.parameter) commit(session, deps, () => ops.setBlend1dParameter(c, state, path, next));
    });
  }

  sectionLabel(ctx, 'list', 'Motion');
  const weights = previewWeights(c, motion);
  motion.children.forEach((child, i) => {
    const childMotion = child.motion;
    // A clip child gets a drop-to-assign slot; a sub-tree child gets a label + open.
    if (childMotion.kind === 'clip') {
      clipSlot(ctx, deps, `bt-clip-${state}-${path.join('.')}-${i}`, childMotion.clip, (h) =>
        commit(session, deps, () => ops.setBlendChildClip(c, state, path, i, h)),
      );
    } else {
      // Name the sub-tree in place — no need to descend just to identify it.
      const curName = childMotion.name ?? '';
      const typeHint = childMotion.kind === 'blend1d' ? '1D Blend Tree' : '2D Blend Tree';
      const nextName = ui.inputText(`##bt-cname-${state}-${path.join('.')}-${i}`, curName, {
        width: Math.max(90, ui.contentAvail()[0] - 60),
        hint: typeHint,
      });
      if (nextName !== curName) commit(session, deps, () => ops.setMotionName(c, state, [...path, i], nextName));
      ui.sameLine(0, 6);
      if (widgets.button(`Open##bt-open-${i}`, { variant: 'secondary', size: 'sm', icon: 'git-fork' })) {
        enterBlendTree(session, state, [...path, i]);
      }
    }
    // Threshold / position + live weight + remove on the following row.
    if (motion.kind === 'blend1d') {
      const th = (child as { threshold: number }).threshold;
      const next = widgets.dragNumber(`##th-${i}`, th, { step: 0.01, width: 70, label: 'Th' });
      if (next !== th) commit(session, deps, () => ops.setChildThreshold(c, state, path, i, next));
    } else {
      const cx = (child as { x: number }).x;
      const cy = (child as { y: number }).y;
      const nx = widgets.dragNumber(`##x-${i}`, cx, { step: 0.01, width: 56, label: 'X' });
      ui.sameLine(0, 3);
      const ny = widgets.dragNumber(`##y-${i}`, cy, { step: 0.01, width: 56, label: 'Y' });
      if (nx !== cx || ny !== cy) commit(session, deps, () => ops.setChildPosition(c, state, path, i, nx, ny));
    }
    ui.sameLine(0, 8);
    ui.textMuted(`${Math.round((weights[i] ?? 0) * 100)}%`);
    ui.sameLine(0, 8);
    if (widgets.iconButton(`bt-del-${i}`, 'x')) commit(session, deps, () => ops.removeBlendChild(c, state, path, i));
    ui.spacing();
  });
  if (motion.children.length === 0) ui.textDisabled('No children — add a clip or sub-tree.');

  ui.spacing();
  if (widgets.button('+ Clip', { variant: 'secondary', size: 'sm' })) commit(session, deps, () => ops.addBlendChild(c, state, path, false));
  ui.sameLine(0, 6);
  if (widgets.button('+ Sub-tree', { variant: 'secondary', size: 'sm' })) commit(session, deps, () => ops.addBlendChild(c, state, path, true));
};

const renderLayerBody = (ctx: EditorContext, session: AnimatorSession, deps: AcAssetDeps | null, index: number): void => {
  const { ui, widgets } = ctx;
  const c = session.controller;
  if (c === null) return;
  // index -1 is the implicit base layer (the controller's own machine).
  if (index === -1) {
    headerBlock(ctx, 'layers', 'Base Layer', c.name ?? 'Base Layer');
    sectionLabel(ctx, 'layers', 'Layer');
    widgets.inspectorRow('Weight', () => ui.textDisabled('1.00 — locked'));
    widgets.inspectorRow('Blend', () => ui.textDisabled('Override'));
    ui.spacing();
    ui.textMuted('The base layer plays this controller’s state machine.');
    return;
  }
  const layer = c.layers[index];
  if (layer === undefined) {
    ui.textDisabled('Layer no longer exists.');
    return;
  }
  headerBlock(ctx, 'layers', `Layer ${index + 1}`, layer.name);

  sectionLabel(ctx, 'layers', 'Layer');
  widgets.inspectorRow('Name', () => {
    const next = ui.inputText('##layer-name', layer.name, { width: ui.contentAvail()[0] });
    if (next !== layer.name) commit(session, deps, () => ops.setLayerField(c, index, { name: next }));
  });
  widgets.inspectorRow('Weight', () => {
    const next = widgets.slider('##layer-weight', layer.weight, { min: 0, max: 1, width: ui.contentAvail()[0] });
    if (next !== layer.weight) commit(session, deps, () => ops.setLayerField(c, index, { weight: next }));
  });
  widgets.inspectorRow('Blend', () => {
    const active = layer.blend === 'additive' ? 1 : 0;
    const picked = widgets.segmented('##layer-blend', ['Override', 'Additive'], active);
    if (picked !== active) commit(session, deps, () => ops.setLayerField(c, index, { blend: picked === 1 ? 'additive' : 'override' }));
  });

  sectionLabel(ctx, 'scan', 'Mask');
  const maskVal = deps !== null && layer.mask !== undefined ? deps.app.getResource(AvatarMasks)?.get(layer.mask) : undefined;
  widgets.inspectorRow('Bones', () => {
    const opts = [{ value: 'none', label: 'None' }, ...(layer.mask !== undefined ? [{ value: 'cur', label: maskVal?.name ?? 'Mask' }] : [])];
    const picked = widgets.combo('##layer-mask', layer.mask !== undefined ? 'cur' : 'none', opts, ui.contentAvail()[0]);
    if (picked === 'none' && layer.mask !== undefined) commit(session, deps, () => ops.setLayerMask(c, index, undefined));
  });
  const maskLabel = layer.mask !== undefined ? `Edit “${maskVal?.name ?? 'mask'}” mask` : 'New mask';
  if (widgets.button(maskLabel, { variant: 'secondary', size: 'sm', icon: 'scan' })) {
    if (layer.mask !== undefined) {
      session.selection = { kind: 'mask', layer: index };
    } else if (deps !== null) {
      void createMaskAsset(deps, `${layer.name} Mask`).then((handle) => {
        if (handle !== undefined) {
          commit(session, deps, () => ops.setLayerMask(c, index, handle));
          session.selection = { kind: 'mask', layer: index };
        }
      });
    }
  }
  if (layer.mask !== undefined) {
    const total = boneUniverse(deps).length;
    ui.textDisabled(`${maskVal?.size ?? 0} of ${total} bones included.`);
  }

  sectionLabel(ctx, 'film', 'Source');
  widgets.inspectorRow('Plays', () => {
    const active = layer.source.kind === 'controller' ? 1 : 0;
    const picked = widgets.segmented('##layer-src', ['Clip', 'Controller'], active);
    if (picked !== active) commit(session, deps, () => ops.setLayerSourceKind(c, index, picked === 1 ? 'controller' : 'clip'));
  });
  if (layer.source.kind === 'clip') {
    const src = layer.source;
    widgets.inspectorRow('Clip', () =>
      clipSlot(ctx, deps, `layer-clip-${index}`, src.clip, (h) => commit(session, deps, () => ops.setLayerClip(c, index, h))),
    );
  } else {
    widgets.inspectorRow('Controller', () => ui.textDisabled(layer.source.kind === 'controller' && layer.source.controller.guid !== undefined ? `${layer.source.controller.guid.slice(0, 8)}…` : 'None — drop a controller'));
  }

  ui.spacing();
  if (widgets.button('Delete Layer', { variant: 'danger', size: 'sm', icon: 'trash-2' })) {
    commit(session, deps, () => ops.removeLayer(c, index));
    session.selection = null;
  }
};

/** Every distinct bone (AnimationTarget id) present in the scene — the mask universe. */
const boneUniverse = (deps: AcAssetDeps | null): string[] => {
  if (deps === null) return [];
  const bones = new Set<string>();
  for (const [, target] of deps.app.world.query([AnimationTarget]).entries()) bones.add((target as AnimationTarget).id);
  return [...bones].sort();
};

const renderMaskBody = (ctx: EditorContext, session: AnimatorSession, deps: AcAssetDeps | null, layerIndex: number): void => {
  const { ui, widgets } = ctx;
  const c = session.controller;
  const layer = c?.layers[layerIndex];
  const maskHandle = layer?.mask;
  if (c === null || c === undefined || layer === undefined || maskHandle === undefined || deps === null) {
    ui.textDisabled('No mask to edit.');
    return;
  }
  const maskValue = deps.app.getResource(AvatarMasks)?.get(maskHandle);
  if (maskValue === undefined) {
    ui.textDisabled('Loading mask…');
    return;
  }

  // Bone universe: every distinct AnimationTarget id present in the world.
  const bones = new Set<string>();
  for (const [, target] of deps.app.world.query([AnimationTarget]).entries()) bones.add((target as AnimationTarget).id);
  const boneList = [...bones].sort();

  if (widgets.button('← Back', { variant: 'secondary', size: 'sm' })) {
    session.selection = { kind: 'layer', index: layerIndex };
    return;
  }
  ui.sameLine(0, 8);
  ui.textColored([0.88, 0.92, 0.88, 1], `Avatar Mask · ${maskValue.size}/${boneList.length}`);
  ui.spacing();

  const saveMask = (): void => {
    void saveMaskAsset(deps, maskHandle);
  };
  if (widgets.button('All', { variant: 'secondary', size: 'sm' })) {
    for (const b of boneList) maskValue.include(b);
    saveMask();
  }
  ui.sameLine(0, 6);
  if (widgets.button('None', { variant: 'secondary', size: 'sm' })) {
    for (const b of boneList) maskValue.exclude(b);
    saveMask();
  }
  ui.spacing();

  if (boneList.length === 0) {
    ui.textDisabled('No skeleton in the scene — open one to author its mask.');
    return;
  }
  for (const bone of boneList) {
    const on = ui.checkbox(`##mask-${bone}`, maskValue.has(bone));
    ui.sameLine(0, 6);
    ui.text(bone);
    if (on !== maskValue.has(bone)) {
      if (on) maskValue.include(bone);
      else maskValue.exclude(bone);
      saveMask();
    }
  }
};

/**
 * Render the Animator's current selection into the (shared) Inspector body.
 * Returns `true` when it rendered something — the caller shows nothing else.
 */
export const renderAnimatorInspectorBody = (
  ctx: EditorContext,
  session: AnimatorSession,
  deps: AcAssetDeps | null,
): boolean => {
  const sel = session.selection;
  if (sel === null || session.controller === null) return false;
  getActivePalette();
  switch (sel.kind) {
    case 'parameter':
      renderParameterBody(ctx, session, deps, sel.index);
      return true;
    case 'state':
      renderStateBody(ctx, session, deps, sel.index);
      return true;
    case 'anyState':
      renderAnyStateBody(ctx, session, deps);
      return true;
    case 'transition':
      renderTransitionBody(ctx, session, deps, sel.index);
      return true;
    case 'blendNode':
      renderBlendNodeBody(ctx, session, deps, sel.state, sel.path);
      return true;
    case 'layer':
      renderLayerBody(ctx, session, deps, sel.index);
      return true;
    case 'mask':
      renderMaskBody(ctx, session, deps, sel.layer);
      return true;
    default:
      return false;
  }
};
