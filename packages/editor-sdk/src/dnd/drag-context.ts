import { ImGui } from '@mori2003/jsimgui';

import type { DragPayload } from './drag-payload';

/**
 * The single ImGui payload type every editor drag uses. ImGui can only marshal a
 * small opaque blob, so the rich typed payload lives JS-side in this module and
 * ImGui carries only this fixed type tag — enough for any target (and the
 * scene-view preview system) to recognise an editor drag and look up its data.
 */
export const DND_TYPE = 'RETRO_DND';

let current: DragPayload | null = null;

/**
 * The JS-side channel for the in-flight drag payload, paired with the ImGui
 * payload tagged {@link DND_TYPE}. A drag source publishes its payload here; any
 * code reads it back with {@link DragContext.peek}, which self-corrects to `null`
 * once the underlying ImGui drag is no longer active.
 */
export interface DragContext {
  /** Publish the payload for the drag starting this frame. */
  set(payload: DragPayload): void;
  /** Forget the current payload. */
  clear(): void;
  /**
   * The active editor drag payload, or `null` when no editor drag is in flight.
   * Must be called during the ImGui frame (it consults the live drag state).
   */
  peek(): DragPayload | null;
}

export const dragContext: DragContext = {
  set(payload: DragPayload): void {
    current = payload;
  },
  clear(): void {
    current = null;
  },
  peek(): DragPayload | null {
    // ImGui returns NULL from GetDragDropPayload when drag/drop is inactive; the
    // binding still hands back a wrapper around that null pointer, so probing it
    // can throw — treat any failure as "no active drag" and drop the stale payload.
    let active = false;
    try {
      const live = ImGui.GetDragDropPayload();
      active = live !== null && live.IsDataType(DND_TYPE);
    } catch {
      active = false;
    }
    if (!active) {
      current = null;
      return null;
    }
    return current;
  },
};
