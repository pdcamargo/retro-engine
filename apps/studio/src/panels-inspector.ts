import {
  createHistoryEmitter,
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type History,
  type InspectorRegistry,
  listComponents,
  type PanelDef,
  renderComponentBody,
  srgbU32,
  type Tone,
  toneColors,
} from '@retro-engine/editor-sdk';
import { type App, AppTypeRegistry, Name } from '@retro-engine/engine';

import { type StudioState } from './state';

/**
 * The INSPECTOR panel — the selected entity's name and its serializable
 * components, each expanded into editable fields via the reflective property
 * inspector. Edits flow through the undo history. Derived components the engine
 * does not persist appear (names only) in debug mode.
 */
export const inspectorPanel = (
  state: StudioState,
  app: App,
  inspector: InspectorRegistry,
  history: History,
): PanelDef => ({
  id: '/inspector',
  title: 'Inspector',
  icon: 'sliders-horizontal',
  slot: 'right',
  closable: true,
  flush: true,
  render: ({ ui, widgets }: EditorContext): void => {
    const p = getActivePalette();
    const selected = state.selectedEntity;
    const alive = selected !== null && app.world.hasEntity(selected);
    const registry = app.getResource(AppTypeRegistry)!.registry;
    const entries = selected !== null && alive ? listComponents(app.world, registry, selected) : [];
    const serializable = entries.filter((c) => c.serializable);
    const derived = entries.filter((c) => !c.serializable);
    const FOOTER_H = 32;
    const totalH = ui.contentAvail()[1];

    // Scrolling body; the footer badges stay pinned at the bottom.
    ui.child('insp-body', { size: [0, totalH - FOOTER_H], border: false, padding: [12, 10] }, () => {
      if (!alive || selected === null) {
        ui.textDisabled('No entity selected.');
        return;
      }
      const name = app.world.getComponent(selected, Name)?.value ?? `Entity ${String(selected)}`;

      // Entity header: accent icon + name + a debug toggle, vertically centered.
      const ih = ui.frameHeight();
      const top = ui.cursorScreenPos();
      drawIcon('box', [top[0] + 2, top[1] + (ih - 16) / 2], 16, srgbU32(p.green400));
      ui.dummy([22, ih]);
      ui.sameLine(0, 4);
      ui.textColored([0.88, 0.92, 0.88, 1], name);
      ui.sameLine(0, 6);
      if (widgets.iconButton('insp-debug', 'bug', { active: state.debugMode, tooltip: 'Show derived components', size: 'sm' })) {
        state.debugMode = !state.debugMode;
      }
      ui.spacing();
      ui.spacing();

      if (serializable.length === 0) {
        ui.textDisabled('No serializable components on this entity.');
      } else {
        for (const [i, comp] of serializable.entries()) {
          const open = widgets.collapsingHeader(`comp-${i}`, { title: comp.name, icon: 'component', defaultOpen: true });
          if (!open) continue;
          const reg = registry.get(comp.name);
          if (reg === undefined) continue;
          const instance = app.world.getComponent(selected, reg.ctor);
          if (instance === undefined) continue;
          renderComponentBody({
            ui,
            widgets,
            reflect: registry,
            inspector,
            instance,
            registered: reg,
            readonly: state.playing,
            edit: createHistoryEmitter(history, selected, reg.name),
          });
        }
      }

      // Derived / non-serializable components — recomputed by systems, not
      // authored — revealed only in debug mode.
      if (state.debugMode && derived.length > 0) {
        ui.spacing();
        ui.textDisabled('Derived');
        ui.spacing();
        for (const [i, comp] of derived.entries()) {
          widgets.collapsingHeader(`derived-${i}`, { title: comp.name, icon: 'circle-dot', defaultOpen: false });
        }
      }
    });

    // Pinned footer — entity id + component count.
    const footTop = ui.cursorScreenPos();
    Draw.window().line([footTop[0], footTop[1]], [footTop[0] + 9999, footTop[1]], srgbU32(p.borderSubtle));
    ui.child('insp-footer', { size: [0, 0], border: false, padding: [12, 7] }, () => {
      const dl = Draw.window();
      const o = ui.cursorScreenPos();
      const badge = (x: number, text: string, tone: Tone): number => {
        const tc = toneColors(tone);
        const ts = ui.calcTextSize(text);
        const w = ts[0] + 14;
        const h = ts[1] + 6;
        dl.rectFilled([x, o[1]], [x + w, o[1] + h], tc.bg, 2);
        if (tc.border !== undefined) dl.rect([x, o[1]], [x + w, o[1] + h], tc.border, 2);
        dl.text([x + 7, o[1] + 3], tc.fg, text);
        return w;
      };
      const w1 = badge(o[0], alive ? `ENTITY #${String(selected)}` : 'NO SELECTION', 'accent');
      const shown = state.debugMode ? entries.length : serializable.length;
      const w2 = badge(o[0] + w1 + 6, `${shown} COMPONENTS`, 'neutral');
      ui.dummy([w1 + 6 + w2, ui.textLineHeight() + 6]);
    });
  },
});
