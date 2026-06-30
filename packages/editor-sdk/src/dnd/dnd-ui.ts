import { type ImGuiPayload, ImGui, ImGuiCond, ImGuiDragDropFlags, type ImVec2 } from '@mori2003/jsimgui';

import { Draw } from '../draw';
import { getActivePalette, srgbU32 } from '../palette';
import type { Vec2 } from '../units';
import { dragContext, DND_TYPE } from './drag-context';
import type { AssetDragPayload, DragPayload, EntityDragPayload } from './drag-payload';

const imv = (v: ImVec2): Vec2 => [v.x, v.y];

const dragLabel = (payload: DragPayload): string => {
  if (payload.kind === 'entity') return (payload as EntityDragPayload).label;
  if (payload.kind === 'asset') return (payload as AssetDragPayload).name;
  return payload.kind;
};

const isDelivery = (payload: ImGuiPayload): boolean => {
  // A non-delivery accept (or the inactive case) wraps a null pointer here, so
  // the probe can throw — read that as "not delivered".
  try {
    return payload.IsDelivery();
  } catch {
    return false;
  }
};

/** Options for {@link Ui.dragSource}. */
export interface DragSourceOptions {
  /**
   * Renders the ghost shown under the cursor while dragging. Defaults to the
   * payload's label as plain text. Runs inside the drag-source tooltip, so it may
   * call any `ui.*` widget.
   */
  readonly preview?: (payload: DragPayload) => void;
}

/** Options for {@link Ui.dropTarget}. */
export interface DropTargetOptions {
  /** Whether this target accepts `payload` — drives the accept vs reject highlight. */
  readonly accepts: (payload: DragPayload) => boolean;
  /** Invoked when an accepted payload is dropped (released) on this target. */
  readonly onDrop: (payload: DragPayload) => void;
  /**
   * Override the hover highlight. Receives the target item's screen rect, whether
   * the payload is accepted, and the payload. Defaults to a green (accept) or red
   * (reject) outline.
   */
  readonly highlight?: (
    rect: readonly [Vec2, Vec2],
    accepted: boolean,
    payload: DragPayload,
  ) => void;
}

const defaultHighlight = (rect: readonly [Vec2, Vec2], accepted: boolean): void => {
  const p = getActivePalette();
  const tone = accepted ? p.green400 : p.red400;
  const dl = Draw.window();
  dl.rectFilled(rect[0], rect[1], srgbU32(tone, 0.12), 3);
  dl.rect(rect[0], rect[1], srgbU32(tone, accepted ? 0.9 : 0.8), 3, 1.5);
};

/**
 * Mark the last-submitted item as a drag source carrying `payload`. Call
 * immediately after submitting the item. Returns `true` on frames the drag is
 * active (so the caller can suppress its own click handling if needed).
 */
export const beginDragSource = (payload: DragPayload, options?: DragSourceOptions): boolean => {
  if (!ImGui.BeginDragDropSource(ImGuiDragDropFlags.None)) return false;
  // The blob is just the kind tag — the real payload rides the JS-side channel.
  ImGui.SetDragDropPayload(DND_TYPE, payload.kind, payload.kind.length, ImGuiCond.Once);
  dragContext.set(payload);
  if (options?.preview !== undefined) options.preview(payload);
  else ImGui.Text(dragLabel(payload));
  ImGui.EndDragDropSource();
  return true;
};

/**
 * Mark the last-submitted item as a drop target. While a compatible editor drag
 * hovers it, draws an accept/reject highlight; on release over an accepted
 * target, invokes `onDrop` with the payload. Call immediately after the item.
 */
export const handleDropTarget = (options: DropTargetOptions): void => {
  if (!ImGui.BeginDragDropTarget()) return;
  try {
    const payload = dragContext.peek();
    if (payload === null) return;
    const accepted = options.accepts(payload);
    const rect: [Vec2, Vec2] = [imv(ImGui.GetItemRectMin()), imv(ImGui.GetItemRectMax())];
    (options.highlight ?? defaultHighlight)(rect, accepted, payload);
    if (!accepted) return;
    // We draw our own highlight, so suppress ImGui's default rect; delivery only
    // fires on release.
    const delivered = ImGui.AcceptDragDropPayload(
      DND_TYPE,
      ImGuiDragDropFlags.AcceptNoDrawDefaultRect,
    );
    if (isDelivery(delivered)) options.onDrop(payload);
  } finally {
    ImGui.EndDragDropTarget();
  }
};
