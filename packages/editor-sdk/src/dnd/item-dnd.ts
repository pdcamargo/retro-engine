import { ui } from '../ui';
import type { DragSourceOptions, DropTargetOptions } from './dnd-ui';
import type { DragPayload } from './drag-payload';

/**
 * Drag-and-drop configuration for a composed widget (a tree row, an asset card,
 * an asset field). Passed as a widget option rather than applied after the widget
 * returns, because these widgets end with decorative draw-list calls — the last
 * ImGui *item* is no longer their interactive control, so an external
 * `ui.dragSource` / `ui.dropTarget` would bind to the wrong (id-less) item.
 */
export interface ItemDnd {
  /** Make the widget a drag source carrying `payload`. */
  readonly source?: { readonly payload: DragPayload; readonly options?: DragSourceOptions };
  /** Make the widget a drop target. */
  readonly target?: DropTargetOptions;
}

/**
 * Attach the drag source and/or drop target to the last-submitted item. Call
 * immediately after a widget's interactive control (its button / selectable),
 * before any decorative draws.
 */
export const applyItemDnd = (dnd: ItemDnd | undefined): void => {
  if (dnd === undefined) return;
  if (dnd.source !== undefined) ui.dragSource(dnd.source.payload, dnd.source.options);
  if (dnd.target !== undefined) ui.dropTarget(dnd.target);
};
