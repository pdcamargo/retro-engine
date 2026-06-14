import {
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type PanelDef,
  srgbU32,
  type Tone,
  toneColors,
  type Widgets,
} from '@retro-engine/editor-sdk';

import { type ComponentModel, type InspectorField } from './scene-data';
import { type StudioState } from './state';

const renderField = (widgets: Widgets, ui: EditorContext['ui'], compType: string, field: InspectorField): void => {
  const id = `${compType}-${field.label}`;
  widgets.inspectorRow(field.label, () => {
    switch (field.kind) {
      case 'vec3':
        field.value = widgets.vec3(id, field.value, { suffix: field.suffix, step: field.step });
        break;
      case 'number':
        field.value = widgets.dragNumber(id, field.value, { suffix: field.suffix, step: field.step });
        break;
      case 'slider':
        field.value = widgets.slider(id, field.value, { min: field.min, max: field.max });
        break;
      case 'color':
        field.value = widgets.colorField(id, field.value);
        break;
      case 'switch':
        field.value = widgets.switchToggle(id, field.value);
        break;
      case 'enum':
        field.value = widgets.combo(
          id,
          field.value,
          field.options.map((o) => ({ value: o })),
        );
        break;
      case 'asset': {
        // A sunken well with the image icon + filename inside, both in text color.
        const p = getActivePalette();
        const w = ui.contentAvail()[0];
        const h = ui.frameHeight();
        const start = ui.cursorScreenPos();
        ui.invisibleButton(`${id}-asset`, [w, h]);
        const dl = Draw.window();
        dl.rectFilled([start[0], start[1]], [start[0] + w, start[1] + h], srgbU32(p.gray4), 2);
        dl.rect([start[0], start[1]], [start[0] + w, start[1] + h], srgbU32(p.gray6), 2);
        drawIcon('image', [start[0] + 7, start[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
        dl.text([start[0] + 28, start[1] + (h - ui.textLineHeight()) / 2], srgbU32(p.text), field.value);
        break;
      }
    }
  });
};

const renderComponent = (widgets: Widgets, ui: EditorContext['ui'], comp: ComponentModel, index: number): void => {
  const open = widgets.collapsingHeader(`comp-${index}`, {
    title: comp.type,
    icon: comp.icon,
    defaultOpen: true,
    onRemove: () => {
      /* remove component */
    },
  });
  if (!open) return;
  ui.spacing();
  for (const field of comp.fields) renderField(widgets, ui, comp.type, field);
  ui.spacing();
};

/** The INSPECTOR panel — the selected entity's header, components, and add control. */
export const inspectorPanel = (state: StudioState): PanelDef => ({
  id: '/inspector',
  title: 'Inspector',
  icon: 'sliders-horizontal',
  slot: 'right',
  closable: true,
  flush: true,
  render: ({ ui, widgets }: EditorContext): void => {
    const p = getActivePalette();
    const selected = state.selected;
    const entity = selected !== null ? state.scene.entities.find((e) => e.id === selected) : undefined;
    const comps = selected !== null ? (state.scene.components[selected] ?? []) : [];
    const FOOTER_H = 32;
    const totalH = ui.contentAvail()[1];

    // Scrolling body; the footer badges stay pinned at the bottom.
    ui.child('insp-body', { size: [0, totalH - FOOTER_H], border: false, padding: [12, 10] }, () => {
      if (entity === undefined) {
        ui.textDisabled('No entity selected.');
        return;
      }
      // Entity header: accent icon + name field + Active toggle, vertically centered.
      const ih = ui.frameHeight();
      const top = ui.cursorScreenPos();
      drawIcon(entity.icon, [top[0] + 2, top[1] + (ih - 16) / 2], 16, srgbU32(p.green400));
      ui.dummy([22, ih]);
      ui.sameLine(0, 4);
      const avail = ui.contentAvail()[0];
      entity.name = ui.inputText('##entity-name', entity.name, { width: avail - 34 });
      ui.sameLine(0, 6);
      widgets.iconButton('entity-active', 'check', { active: entity.visible, tooltip: 'Active', size: 'sm' });
      ui.spacing();
      ui.spacing();

      if (comps.length === 0) {
        ui.textDisabled('No components on this entity.');
      } else {
        for (const [i, comp] of comps.entries()) renderComponent(widgets, ui, comp, i);
      }

      ui.spacing();
      ui.spacing();
      if (widgets.button('Add Component', { variant: 'secondary', block: true, icon: 'plus' })) {
        /* open add-component picker */
      }
    });

    // Pinned footer — both badges drawn at absolute positions on one baseline.
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
      const w1 = badge(o[0], 'ENTITY #1041', 'accent');
      const w2 = badge(o[0] + w1 + 6, `${comps.length} COMPONENTS`, 'neutral');
      ui.dummy([w1 + 6 + w2, ui.textLineHeight() + 6]);
    });
  },
});
