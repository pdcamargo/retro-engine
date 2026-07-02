// The Animator panel — a self-contained editor for an AnimationController: a
// Layers/Parameters sidebar, a breadcrumb bar with zoom controls, and the graph
// canvas (state machine, or a blend tree once descended) drawn by the shared
// graph-editor toolkit. The Inspector is the studio's shared panel, populated
// elsewhere; this panel owns the sidebar + canvas.

import {
  Draw,
  drawIcon,
  type EditorContext,
  type History,
  getActivePalette,
  type PanelDef,
  srgbU32,
} from '@retro-engine/editor-sdk';
import { GraphEditor } from '@retro-engine/graph-editor';

import type { ControllerParameter } from '@retro-engine/engine';

import { type AcAssetDeps, saveOpenController, tickPendingOpen } from './ac-asset';
import { addLayer, addParameter, deleteState, deleteTransition, renameParameter, setLayerField } from './ac-ops';
import type { ParameterType } from '@retro-engine/engine';
import { motionAtPath, motionChildLabel, stateNodeId } from './ac-codec';
import {
  type AnimatorSelection,
  type AnimatorSession,
  type SidebarTab,
  enterBlendTree,
  exitToStateMachine,
  rebuildSession,
} from './animator-session';
import type { StudioState } from '../state';

/** The breadcrumb path labels for the current view (controller ▸ state ▸ sub-trees…). */
const breadcrumbLabels = (session: AnimatorSession): string[] => {
  const labels = [session.controller?.name ?? 'Animation Controller'];
  const bc = session.breadcrumb;
  if (bc === null || session.controller === null) return labels;
  const st = session.controller.states[bc.state];
  labels.push(st?.name ?? 'State');
  let motion = st?.motion;
  bc.path.forEach((childIdx) => {
    const child = motion !== undefined && motion.kind !== 'clip' ? motion.children[childIdx]?.motion : undefined;
    labels.push(child !== undefined ? motionChildLabel(child, childIdx) : '?');
    motion = child;
  });
  return labels;
};

/** Pop one blend-tree level (or return to the state machine when at the top). */
const popBreadcrumb = (session: AnimatorSession): void => {
  const bc = session.breadcrumb;
  if (bc === null) return;
  if (bc.path.length === 0) exitToStateMachine(session);
  else enterBlendTree(session, bc.state, bc.path.slice(0, -1));
};

/** Set the Animator's selection and clear the entity/asset selection (mutually exclusive). */
const select = (session: AnimatorSession, studio: StudioState, sel: AnimatorSelection | null): void => {
  session.selection = sel;
  if (sel !== null) {
    studio.selectedEntity = null;
    studio.selectedAsset = null;
  }
};

/** Begin an inline rename of a sidebar row (grabs keyboard focus next frame). */
const startRename = (session: AnimatorSession, kind: 'parameter' | 'layer', index: number, name: string): void => {
  session.renaming = { kind, index };
  session.renameBuffer = name;
  session.renameFocus = true;
};

/**
 * Mirror the canvas's node/edge selection into the Animator selection, but only
 * when it changed this frame — so selecting an entity elsewhere is not stomped by
 * the graph's still-highlighted node.
 */
const syncCanvasSelection = (session: AnimatorSession, studio: StudioState): void => {
  // In a blend tree the Inspector shows the whole tree (blendNode selection); the
  // canvas nodes there aren't states/transitions, so skip the state-machine sync.
  if (session.breadcrumb !== null) return;
  const { view } = session;
  const nodeKey = [...view.selection].sort().join(',');
  const edgeKey = [...view.edgeSelection].sort().join(',');
  if (nodeKey === session.lastNodeKey && edgeKey === session.lastEdgeKey) return;
  session.lastNodeKey = nodeKey;
  session.lastEdgeKey = edgeKey;

  const node = [...view.selection][0];
  const edge = [...view.edgeSelection][0];
  if (node === 'any') {
    select(session, studio, { kind: 'anyState' });
  } else if (node !== undefined && node.startsWith('state:')) {
    select(session, studio, { kind: 'state', index: Number(node.slice('state:'.length)) });
  } else if (edge !== undefined && session.edgeTransition.has(edge)) {
    select(session, studio, { kind: 'transition', index: session.edgeTransition.get(edge)! });
  } else if (
    view.selection.size === 0 &&
    view.edgeSelection.size === 0 &&
    (session.selection?.kind === 'state' ||
      session.selection?.kind === 'transition' ||
      session.selection?.kind === 'anyState')
  ) {
    // Only a canvas deselect clears a canvas-derived selection; sidebar selections
    // (parameter / layer) are owned by the sidebar and must not be stomped here.
    session.selection = null;
  }
};

const SIDEBAR_W = 210;
const BREADCRUMB_H = 28;
const TAB_H = 30;

/** Round dot (float/bool) or square (trigger) type indicator, colored by type. */
const drawParamGlyph = (dl: Draw, cx: number, cy: number, param: ControllerParameter): void => {
  const p = getActivePalette();
  const col = srgbU32(param.type === 'float' ? p.green400 : param.type === 'bool' ? p.red400 : p.amber400);
  if (param.type === 'trigger') {
    dl.rectFilled([cx - 4, cy - 4], [cx + 4, cy + 4], col, 1);
  } else {
    dl.circleFilled([cx, cy], 4.5, col);
  }
};

const paramValueText = (param: ControllerParameter): string =>
  param.type === 'trigger' ? '' : param.type === 'bool' ? (param.default >= 0.5 ? 'true' : 'false') : param.default.toFixed(2);

const renderParameters = (
  ctx: EditorContext,
  session: AnimatorSession,
  studio: StudioState,
  deps: () => AcAssetDeps | null,
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const c = session.controller;
  const params = c?.parameters ?? [];
  const q = session.filter.trim().toLowerCase();
  const dl = Draw.window();
  const rowH = 26;
  let shown = 0;
  params.forEach((param, index) => {
    if (q !== '' && !param.name.toLowerCase().includes(q)) return;
    shown++;
    const top = ui.cursorScreenPos();
    const w = ui.contentAvail()[0];
    const midY = top[1] + rowH / 2;
    const editing = session.renaming?.kind === 'parameter' && session.renaming.index === index;

    if (editing && c !== null) {
      // Inline rename: type dot + a focused text field in place of the name.
      drawParamGlyph(dl, top[0] + 14, midY, param);
      ui.dummy([26, rowH]);
      ui.sameLine(0, 0);
      if (session.renameFocus) {
        ui.setKeyboardFocusHere();
        session.renameFocus = false;
      }
      session.renameBuffer = ui.inputText(`##rename-param-${index}`, session.renameBuffer, { width: w - 26 - 10 });
      if (ui.isItemDeactivatedAfterEdit()) {
        renameParameter(c, index, session.renameBuffer);
        rebuildSession(session);
        const d = deps();
        if (d !== null) void saveOpenController(d);
        session.renaming = null;
      } else if (ui.isItemDeactivated()) {
        session.renaming = null; // Escape / clicked away without editing.
      }
      return;
    }

    const selected = session.selection?.kind === 'parameter' && session.selection.index === index;
    if (ui.invisibleButton(`param-${index}`, [w, rowH])) {
      select(session, studio, { kind: 'parameter', index });
      session.view.selection.clear();
      session.view.edgeSelection.clear();
    }
    // Double-click a row to rename it inline.
    if (ui.isItemHovered() && ui.isMouseDoubleClicked(0)) startRename(session, 'parameter', index, param.name);
    if (selected) dl.rectFilled([top[0], top[1]], [top[0] + 3, top[1] + rowH], srgbU32(p.green400));
    drawParamGlyph(dl, top[0] + 14, midY, param);
    dl.text([top[0] + 28, midY - 6], srgbU32(p.text), param.name);
    const value = paramValueText(param);
    if (value !== '') {
      dl.text([top[0] + w - ui.calcTextSize(value)[0] - 8, midY - 6], srgbU32(p.textMuted), value);
    } else {
      drawIcon('zap', [top[0] + w - 18, midY - 7], 13, srgbU32(p.amber400));
    }
  });
  if (shown === 0) ui.textMuted(q === '' ? 'No parameters — click + to add' : 'No matches');
};

const renderLayers = (
  ctx: EditorContext,
  session: AnimatorSession,
  studio: StudioState,
  deps: () => AcAssetDeps | null,
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const c = session.controller;
  const dl = Draw.window();
  const layers = c?.layers ?? [];
  const q = session.filter.trim().toLowerCase();
  // Additional layers on top (index 0 first), then the implicit base layer.
  const rows: { name: string; badge: string; weight: number; masked: boolean; index: number }[] = [
    ...layers.map((l, i) => ({ name: l.name, badge: l.blend === 'additive' ? 'ADD' : 'OVER', weight: l.weight, masked: l.mask !== undefined, index: i })),
    { name: c?.name ?? 'Base Layer', badge: 'OVER', weight: 1, masked: false, index: -1 },
  ];
  for (const row of rows) {
    if (q !== '' && !row.name.toLowerCase().includes(q)) continue;
    const top = ui.cursorScreenPos();
    const w = ui.contentAvail()[0];
    const rowH = 38;
    // Inline rename (additional layers only; the base layer isn't renamable).
    if (c !== null && row.index >= 0 && session.renaming?.kind === 'layer' && session.renaming.index === row.index) {
      drawIcon('layers', [top[0] + 12, top[1] + 8], 14, srgbU32(p.textMuted));
      ui.dummy([32, rowH]);
      ui.sameLine(0, 0);
      if (session.renameFocus) {
        ui.setKeyboardFocusHere();
        session.renameFocus = false;
      }
      session.renameBuffer = ui.inputText(`##rename-layer-${row.index}`, session.renameBuffer, { width: w - 32 - 10 });
      if (ui.isItemDeactivatedAfterEdit()) {
        setLayerField(c, row.index, { name: session.renameBuffer });
        rebuildSession(session);
        const d = deps();
        if (d !== null) void saveOpenController(d);
        session.renaming = null;
      } else if (ui.isItemDeactivated()) {
        session.renaming = null;
      }
      continue;
    }
    const selected = session.selection?.kind === 'layer' && session.selection.index === row.index;
    if (ui.invisibleButton(`layer-${row.index}`, [w, rowH])) {
      select(session, studio, { kind: 'layer', index: row.index });
      session.view.selection.clear();
      session.view.edgeSelection.clear();
    }
    // Double-click an additional layer to rename it inline.
    if (row.index >= 0 && ui.isItemHovered() && ui.isMouseDoubleClicked(0)) startRename(session, 'layer', row.index, row.name);
    if (selected) dl.rectFilled([top[0], top[1]], [top[0] + 3, top[1] + rowH], srgbU32(p.green400));
    drawIcon('layers', [top[0] + 12, top[1] + 6], 14, srgbU32(row.index === -1 ? p.textFaint : p.textMuted));
    dl.text([top[0] + 32, top[1] + 6], srgbU32(p.text), row.name);
    if (row.masked) drawIcon('scan', [top[0] + w - 52, top[1] + 5], 12, srgbU32(p.textFaint));
    dl.text([top[0] + w - ui.calcTextSize(row.badge)[0] - 8, top[1] + 6], srgbU32(p.textFaint), row.badge);
    const bx = top[0] + 32;
    const by = top[1] + 24;
    const bw = w - 40 - bx + top[0];
    dl.rectFilled([bx, by], [bx + bw, by + 4], srgbU32(p.gray4), 2);
    dl.rectFilled([bx, by], [bx + bw * Math.max(0, Math.min(1, row.weight)), by + 4], srgbU32(p.green400), 2);
  }
};

const renderSidebar = (
  ctx: EditorContext,
  session: AnimatorSession,
  studio: StudioState,
  deps: () => AcAssetDeps | null,
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  ui.child('animator-sidebar', { size: [SIDEBAR_W, 0], border: false, padding: [0, 0], noScrollbar: true }, () => {
    const dl = Draw.window();
    // The Animator's panels sit on the same near-black void as the canvas.
    const o = ui.cursorScreenPos();
    const availH = ui.contentAvail()[1];
    dl.rectFilled([o[0], o[1]], [o[0] + SIDEBAR_W, o[1] + availH], srgbU32(p.gray0));

    ui.withItemSpacing(0, 0, () => {
      // Tab row: left-aligned icon+label tabs; active gets a 2px phosphor underline.
      const tabTop = ui.cursorScreenPos();
      const tabs: { id: SidebarTab; label: string; icon: string }[] = [
        { id: 'layers', label: 'Layers', icon: 'layers' },
        { id: 'parameters', label: 'Parameters', icon: 'sliders-horizontal' },
      ];
      let cx = tabTop[0] + 6;
      tabs.forEach((tab, i) => {
        if (i === 0) ui.dummy([6, TAB_H]);
        ui.sameLine(0, 0);
        const labelW = ui.calcTextSize(tab.label)[0];
        const tabW = 16 + 6 + labelW + 16;
        const clicked = ui.invisibleButton(`animtab-${tab.id}`, [tabW, TAB_H]);
        ui.sameLine(0, 0);
        const active = session.sidebarTab === tab.id;
        const col = srgbU32(active ? p.text : p.textMuted);
        drawIcon(tab.icon, [cx, tabTop[1] + (TAB_H - 14) / 2], 14, col);
        dl.text([cx + 20, tabTop[1] + (TAB_H - 12) / 2], col, tab.label);
        if (active) dl.rectFilled([cx - 2, tabTop[1] + TAB_H - 2], [cx + 20 + labelW + 2, tabTop[1] + TAB_H], srgbU32(p.green400));
        if (clicked) {
          session.sidebarTab = tab.id;
          session.filter = '';
        }
        cx += tabW;
      });
      ui.dummy([0, TAB_H]);
      // 1px divider under the tabs, full width.
      dl.rectFilled([tabTop[0], tabTop[1] + TAB_H - 1], [tabTop[0] + SIDEBAR_W, tabTop[1] + TAB_H], srgbU32(p.gray4));

      // Filter row: a field with the search glyph *inside* on the left, plus a
      // square add button the same height as the field.
      ui.dummy([0, 8]);
      const h = ui.frameHeight();
      const LM = 10;
      const inputW = SIDEBAR_W - LM * 2 - h - 6;
      ui.dummy([LM, h]);
      ui.sameLine(0, 0);
      session.filter = ui.inputText('##animator-filter', session.filter, { hint: 'Filter', icon: 'search', width: inputW });
      ui.sameLine(0, 6);
      const addHit = ui.invisibleButton('animator-add', [h, h]);
      const [amin, amax] = ui.itemRect();
      const ahov = ui.isItemHovered();
      dl.rectFilled(amin, amax, srgbU32(ahov ? p.gray5 : p.gray4), 3);
      drawIcon('plus', [(amin[0] + amax[0]) / 2 - 7.5, (amin[1] + amax[1]) / 2 - 7.5], 15, srgbU32(ahov ? p.text : p.textMuted));
      if (addHit) {
        if (session.sidebarTab === 'parameters') {
          ui.openPopup('anim-add-param'); // Unity-style: choose the parameter type.
        } else {
          const c = session.controller;
          const d = deps();
          if (c !== null) {
            const layer = addLayer(c);
            rebuildSession(session);
            if (d !== null) void saveOpenController(d);
            const idx = c.layers.length - 1;
            select(session, studio, { kind: 'layer', index: idx });
            startRename(session, 'layer', idx, layer.name);
          }
        }
      }
      // Typed-parameter menu; picking a type adds it and drops straight into rename.
      ui.popup('anim-add-param', () => {
        const c = session.controller;
        const addTyped = (type: ParameterType): void => {
          if (c === null) return;
          const param = addParameter(c, type);
          rebuildSession(session);
          const d = deps();
          if (d !== null) void saveOpenController(d);
          const idx = c.parameters.length - 1;
          select(session, studio, { kind: 'parameter', index: idx });
          startRename(session, 'parameter', idx, param.name);
          ui.closePopup();
        };
        const pdl = Draw.window();
        const IW = 168;
        const IH = 30;
        const menuItem = (label: string, type: ParameterType): void => {
          const it = ui.cursorScreenPos();
          const hit = ui.invisibleButton(`addp-${type}`, [IW, IH]);
          const hov = ui.isItemHovered();
          const gy = it[1] + IH / 2;
          if (hov) pdl.rectFilled([it[0], it[1]], [it[0] + IW, it[1] + IH], srgbU32(p.gray5), 4);
          const gcol = srgbU32(type === 'float' ? p.green400 : type === 'bool' ? p.red400 : p.amber400);
          if (type === 'trigger') pdl.rectFilled([it[0] + 12, gy - 4], [it[0] + 20, gy + 4], gcol, 1);
          else pdl.circleFilled([it[0] + 16, gy], 4.5, gcol);
          pdl.text([it[0] + 32, gy - 6], srgbU32(hov ? p.text : p.textMuted), label);
          if (hit) addTyped(type);
        };
        menuItem('Float', 'float');
        menuItem('Bool', 'bool');
        menuItem('Trigger', 'trigger');
      });
      ui.dummy([0, 6]);
    });

    // The scrollable list gets its own region (scrolls when the list is long). Fill
    // it with the same void; tighten row spacing to match the design's dense list.
    ui.child('animator-list', { size: [0, 0], border: false, padding: [0, 0] }, () => {
      const lo = ui.cursorScreenPos();
      const la = ui.contentAvail();
      Draw.window().rectFilled([lo[0], lo[1]], [lo[0] + la[0], lo[1] + la[1]], srgbU32(p.gray0));
      ui.withItemSpacing(0, 2, () => {
        if (session.sidebarTab === 'layers') renderLayers(ctx, session, studio, deps);
        else renderParameters(ctx, session, studio, deps);
      });
    });
  });
};

const zoomClamp = (z: number): number => Math.max(0.35, Math.min(2, z));

const renderBreadcrumbAndCanvas = (
  ctx: EditorContext,
  session: AnimatorSession,
  history: History,
  deps: () => AcAssetDeps | null,
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const view = session.view;
  ui.child('animator-right', { size: [0, 0], border: false, padding: [0, 0] }, () => {
    // Breadcrumb bar: controller (▸ nested crumbs later) on the left, zoom on the right.
    const top = ui.cursorScreenPos();
    const w = ui.contentAvail()[0];
    const dl = Draw.window();
    dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + BREADCRUMB_H], srgbU32(p.gray0));
    dl.rectFilled([top[0], top[1] + BREADCRUMB_H - 1], [top[0] + w, top[1] + BREADCRUMB_H], srgbU32(p.gray4));
    // Breadcrumb trail (controller › state › sub-trees…); trailing crumb is bright.
    // Separators are chevron glyphs, not a unicode char the mono font can't render.
    const labels = breadcrumbLabels(session);
    drawIcon(session.breadcrumb === null ? 'layers' : 'git-fork', [top[0] + 8, top[1] + (BREADCRUMB_H - 14) / 2], 14, srgbU32(p.textFaint));
    const ty = top[1] + (BREADCRUMB_H - 12) / 2;
    let cxb = top[0] + 28;
    labels.forEach((label, i) => {
      if (i > 0) {
        drawIcon('chevron-right', [cxb, ty - 1], 13, srgbU32(p.textFaint));
        cxb += 17;
      }
      dl.text([cxb, ty], srgbU32(i === labels.length - 1 ? p.text : p.textMuted), label);
      cxb += ui.calcTextSize(label)[0] + 6;
    });

    // Right-aligned zoom controls (−, %, +, fit) drawn flush on the bar. Each icon
    // is centered on its button's *actual* rect (via itemRect) so the glyph and the
    // click target never diverge, whatever the layout flow does.
    const zt = `${Math.round(view.zoom * 100)}%`;
    const BTN = 22;
    const pctW = ui.calcTextSize(zt)[0];
    const fitX = w - 10 - BTN;
    const plusX = fitX - BTN - 2;
    const pctX = plusX - 8 - pctW;
    const minusX = pctX - 8 - BTN;
    // The bar's true vertical center (matches the trail text + percent readout). The
    // invisible hit target is full bar-height, so a small layout offset can't stop a
    // click landing on the glyph — but the glyph itself is drawn on this center.
    const barMidY = top[1] + BREADCRUMB_H / 2;
    const zoomBtn = (id: string, localX: number, icon: string, onClick: () => void): void => {
      ui.sameLine(localX);
      const hit = ui.invisibleButton(id, [BTN, BREADCRUMB_H]);
      const hov = ui.isItemHovered();
      const [rmin, rmax] = ui.itemRect();
      const bcx = (rmin[0] + rmax[0]) / 2; // horizontal from the real button; vertical from the bar
      if (hov) dl.rectFilled([bcx - BTN / 2, barMidY - 11], [bcx + BTN / 2, barMidY + 11], srgbU32(p.gray4), 3);
      drawIcon(icon, [bcx - 7.5, barMidY - 7.5], 15, srgbU32(hov ? p.text : p.textMuted));
      if (hit) onClick();
    };
    // Left region back-nav (up one blend-tree level); stops short of the controls.
    if (ui.invisibleButton('animator-breadcrumb-back', [Math.max(1, minusX), BREADCRUMB_H]) && session.breadcrumb !== null) {
      popBreadcrumb(session);
    }
    if (session.breadcrumb !== null) ui.setItemTooltip('Back up one level');
    zoomBtn('anim-zoom-out', minusX, 'minus', () => {
      view.zoom = zoomClamp(view.zoom * 0.9);
      view.userNavigated = true;
    });
    zoomBtn('anim-zoom-in', plusX, 'plus', () => {
      view.zoom = zoomClamp(view.zoom / 0.9);
      view.userNavigated = true;
    });
    zoomBtn('anim-zoom-fit', fitX, 'maximize', () => {
      session.fitRequested = true;
    });
    // The percent readout, vertically centered between the − and + buttons.
    dl.text([top[0] + pctX, top[1] + (BREADCRUMB_H - 12) / 2], srgbU32(p.textMuted), zt);

    // Pin the canvas flush under the breadcrumb — the breadcrumb's hit-target items
    // otherwise leave an item-flow row + spacing gap below the bar.
    ui.setCursorScreenPos([top[0], top[1] + BREADCRUMB_H]);
    ui.child('animator-canvas', { size: [0, 0], border: false, padding: [0, 0], noScrollbar: true }, () => {
      const doc = session.host.active();
      if (doc === undefined) {
        ui.textMuted('No controller open');
        return;
      }
      const params = {
        ui,
        doc,
        view: session.view,
        env: session.host.env,
        theme: session.theme,
        history,
        overlays: { minimap: false, status: false },
      };
      if (session.fitRequested) {
        session.view.userNavigated = false;
        session.fitRequested = false;
      }
      if (!session.view.userNavigated) GraphEditor.fit(params);
      GraphEditor.draw(params);

      // Double-clicking a blend node descends into its tree (same as the inspector's
      // "Open blend tree"). Works at both levels: a blend *state* on the state machine,
      // and a nested sub-tree *child* while already inside a blend tree. The click
      // already selected the node.
      if (ui.isMouseDoubleClicked(0)) {
        const sel = [...session.view.selection];
        const id = sel.length === 1 ? sel[0]! : undefined;
        const bc = session.breadcrumb;
        if (id !== undefined && bc === null && id.startsWith('state:')) {
          const idx = Number(id.slice('state:'.length));
          const motion = session.controller?.states[idx]?.motion;
          if (motion !== undefined && motion.kind !== 'clip') enterBlendTree(session, idx, []);
        } else if (id !== undefined && bc !== null && id.startsWith('child:')) {
          const childIdx = Number(id.slice('child:'.length));
          const childPath = [...bc.path, childIdx];
          const root = session.controller?.states[bc.state]?.motion;
          const childMotion = root !== undefined ? motionAtPath(root, childPath) : undefined;
          if (childMotion !== undefined && childMotion.kind !== 'clip') enterBlendTree(session, bc.state, childPath);
        }
      }

      // The graph toolkit's Delete key removes nodes/edges from the *derived* doc;
      // reflect those removals into the controller (the source of truth) so they
      // don't reappear on the next rebuild.
      const c = session.controller;
      if (session.breadcrumb === null && c !== null) {
        const goneTr = [...session.edgeTransition].filter(([eid]) => doc.edges[eid] === undefined).map(([, ti]) => ti);
        const goneStates = c.states.map((_, i) => i).filter((i) => doc.nodes[stateNodeId(i)] === undefined);
        if (goneTr.length > 0 || goneStates.length > 0) {
          for (const ti of goneTr.sort((a, b) => b - a)) deleteTransition(c, ti);
          for (const si of goneStates.sort((a, b) => b - a)) deleteState(c, si);
          rebuildSession(session);
          const d = deps();
          if (d !== null) void saveOpenController(d);
          session.selection = null;
        }
      }
    });
  });
};

/** The Animator panel: sidebar + breadcrumb + graph canvas for one controller. */
export const animatorPanel = (
  session: AnimatorSession,
  history: History,
  deps: () => AcAssetDeps | null,
  studio: StudioState,
): PanelDef => ({
  id: '/animator',
  title: 'Animator',
  icon: 'film',
  slot: 'center',
  closable: true,
  flush: true,
  render: (ctx: EditorContext): void => {
    const d = deps();
    if (d !== null) tickPendingOpen(d);
    const p = getActivePalette();
    const origin = ctx.ui.cursorScreenPos();
    const paneH = ctx.ui.contentAvail()[1];
    renderSidebar(ctx, session, studio, deps);
    ctx.ui.sameLine(0, 1);
    renderBreadcrumbAndCanvas(ctx, session, history, deps);
    // 1px seam between the sidebar and the canvas.
    Draw.window().rectFilled([origin[0] + SIDEBAR_W, origin[1]], [origin[0] + SIDEBAR_W + 1, origin[1] + paneH], srgbU32(p.gray4));
    // After the canvas draws (updating the graph view's selection), mirror it.
    syncCanvasSelection(session, studio);
  },
});
