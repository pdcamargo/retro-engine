import { type EditorContext, type History } from '@retro-engine/editor-sdk';

import { type StudioState } from './state';

/**
 * The Clear History confirmation modal. Toggled by `state.historyClearConfirm`
 * (set by the History panel's trash button and the Edit ▸ Clear History menu);
 * the dialog requests open once when the flag flips true and drops the whole
 * undo/redo stack on confirm.
 */
export const historyClearDialog = ({ ui, widgets }: EditorContext, state: StudioState, history: History): void => {
  if (state.historyClearConfirm && !openedThisSession) {
    widgets.openDialog('history-clear');
    openedThisSession = true;
  }
  if (!state.historyClearConfirm) openedThisSession = false;

  widgets.dialog({ id: 'history-clear', title: 'Clear History', icon: 'trash-2', width: 360 }, () => {
    ui.textWrapped('Discard the entire undo/redo history? This cannot be undone.');
    ui.separator();
    ui.rightAlign(170);
    if (widgets.button('Cancel', { variant: 'ghost' })) {
      state.historyClearConfirm = false;
      widgets.closeDialog();
    }
    ui.sameLine();
    if (widgets.button('Clear', { variant: 'danger', icon: 'trash-2' })) {
      history.clear();
      state.historyClearConfirm = false;
      widgets.closeDialog();
    }
  });
};

// Module-level latch so the popup is requested once per open (immediate-mode popups
// must be opened by an explicit call, not re-requested every frame).
let openedThisSession = false;
