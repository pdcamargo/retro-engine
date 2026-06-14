import { type EditorContext } from '@retro-engine/editor-sdk';

import { type StudioState } from './state';

const SET_LABEL_W = 118;

const settingsRow = (ui: EditorContext['ui'], label: string, control: () => void): void => {
  ui.alignTextToFramePadding();
  ui.textMuted(label);
  ui.sameLine(SET_LABEL_W);
  ui.group(control);
};

/**
 * The Project Settings modal — opened from the toolbar / File menu. Toggled by
 * `state.settingsOpen`; the dialog requests open once when it flips true.
 */
export const projectSettingsDialog = ({ ui, widgets }: EditorContext, state: StudioState): void => {
  // Drive the popup open exactly once per flip of the flag.
  if (state.settingsOpen && !openedThisSession) {
    widgets.openDialog('project-settings');
    openedThisSession = true;
  }
  if (!state.settingsOpen) openedThisSession = false;

  widgets.dialog({ id: 'project-settings', title: 'Project Settings', icon: 'settings', width: 460 }, () => {
    const s = state.settings;
    settingsRow(ui, 'Renderer', () => {
      s.renderer = widgets.combo(
        'set-renderer',
        s.renderer,
        [{ value: 'WebGPU' }, { value: 'WebGL2' }, { value: 'Auto' }],
        ui.contentAvail()[0],
      );
    });
    settingsRow(ui, 'Color space', () => {
      s.colorSpace = widgets.radioGroup('set-colorspace', s.colorSpace, [{ value: 'Linear' }, { value: 'sRGB' }]);
    });
    settingsRow(ui, 'Target FPS', () => {
      s.targetFps = widgets.inputNumber('set-fps', s.targetFps, { integer: true, step: 5, stepFast: 30, min: 30, max: 240, width: 130 });
    });
    settingsRow(ui, 'VSync', () => {
      s.vsync = widgets.switchToggle('set-vsync', s.vsync);
    });
    settingsRow(ui, 'Autosave scene', () => {
      s.autosave = widgets.switchToggle('set-autosave', s.autosave);
    });
    settingsRow(ui, 'Pixel scale', () => {
      s.pixelScale = widgets.slider('set-pixel', s.pixelScale, { min: 1, max: 4, integer: true, suffix: '×' });
    });
    settingsRow(ui, 'Clear color', () => {
      s.clearColor = widgets.colorField('set-clear', s.clearColor);
    });
    settingsRow(ui, 'Render layers', () => {
      s.renderLayer = widgets.listBox(
        'set-layers',
        s.renderLayer,
        [{ value: 'Default' }, { value: 'Background' }, { value: 'Effects' }, { value: 'UI' }],
        3,
      );
    });

    ui.separator();
    widgets.hyperlink('Documentation', { url: 'https://example.com/docs' });
    ui.sameLine();
    ui.rightAlign(150);
    if (widgets.button('Cancel', { variant: 'ghost' })) {
      state.settingsOpen = false;
      widgets.closeDialog();
    }
    ui.sameLine();
    if (widgets.button('Save', { variant: 'primary', icon: 'check' })) {
      state.settingsOpen = false;
      widgets.closeDialog();
    }
  });
};

// Module-level latch so the popup is requested once per open (immediate-mode popups
// must be opened by an explicit call, not re-requested every frame).
let openedThisSession = false;
