/**
 * Where a panel docks by default in the editor shell. `float` leaves the panel
 * undocked (the user can dock it anywhere).
 */
export type DockSlot = 'left' | 'right' | 'center' | 'bottom' | 'float';

/**
 * Stable dock-node ids for the shell's default layout. They are constants (not
 * runtime-assigned) so the same ids can seed the docking-tree `ini` and be
 * passed to `SetNextWindowDockID`, binding panels to nodes without depending on
 * window-name hashing.
 */
export const DockNodeId = {
  main: 0x00ed0001,
  left: 0x00ed0010,
  center: 0x00ed0011,
  bottom: 0x00ed0012,
  right: 0x00ed0013,
  mid: 0x00ed0014,
  centerCol: 0x00ed0015,
} as const;

/**
 * Window id of the dockspace host (`###re-dockhost`) — Dear ImGui's hash of the
 * id string. The default-layout `ini` must reference it on the `DockSpace` line
 * (`Window=`) or ImGui discards the split tree and falls back to a bare central
 * node. Stable as long as the host window's id string is unchanged.
 */
export const DOCK_HOST_WINDOW_ID = 0x46c47a52;

/** The dock node a slot resolves to, or `undefined` for floating panels. */
export const nodeForSlot = (slot: DockSlot): number | undefined => {
  switch (slot) {
    case 'left':
      return DockNodeId.left;
    case 'right':
      return DockNodeId.right;
    case 'center':
      return DockNodeId.center;
    case 'bottom':
      return DockNodeId.bottom;
    case 'float':
    default:
      return undefined;
  }
};

/** Default region sizes (px) for the shell layout. */
export interface LayoutDims {
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly bottomHeight: number;
  /** Nominal work area used for the seed `SizeRef`s; ImGui rescales to the real size. */
  readonly total: readonly [number, number];
}

/** The design system's default region sizes: hierarchy 250, inspector 312, dock 224. */
export const defaultDims: LayoutDims = {
  leftWidth: 250,
  rightWidth: 312,
  bottomHeight: 224,
  total: [1280, 660],
};

const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

/**
 * Build the Dear ImGui layout `ini` for the shell's default arrangement: a left
 * column (hierarchy), a center column split into a central viewport node over a
 * bottom dock, and a right column (inspector). Node ids come from
 * {@link DockNodeId}; the root binds to `DockSpace(DockNodeId.main)` inside the
 * `###re-dockhost` window. Each panel id is given a `DockId` entry so it binds on
 * load. `panelIds` maps a slot to the panel window-ids docked there.
 */
export const buildDefaultLayout = (
  panelIds: Readonly<Record<'left' | 'right' | 'center' | 'bottom', readonly string[]>>,
  dims: LayoutDims = defaultDims,
): string => {
  const [w, h] = dims.total;
  const top = 65; // below the menu bar + toolbar rail
  const bodyH = h - top;
  const midW = w - dims.leftWidth;
  const centerW = midW - dims.rightWidth;
  const centerH = bodyH - dims.bottomHeight;
  const n = DockNodeId;

  const windowEntries: string[] = [`[Window][re-dockhost]`, `Pos=0,${top}`, `Size=${w},${bodyH}`, `Collapsed=0`, ``];
  const dockFor = (slot: 'left' | 'right' | 'center' | 'bottom'): number =>
    slot === 'left' ? n.left : slot === 'right' ? n.right : slot === 'center' ? n.center : n.bottom;
  for (const slot of ['left', 'center', 'bottom', 'right'] as const) {
    panelIds[slot].forEach((id, tabIndex) => {
      windowEntries.push(`[Window][${id}]`, `Collapsed=0`, `DockId=${hex(dockFor(slot))},${tabIndex}`, ``);
    });
  }

  const docking = [
    '[Docking][Data]',
    `DockSpace   ID=${hex(n.main)} Window=${hex(DOCK_HOST_WINDOW_ID)} Pos=0,${top} Size=${w},${bodyH} Split=X`,
    `  DockNode  ID=${hex(n.left)} Parent=${hex(n.main)} SizeRef=${dims.leftWidth},${bodyH}`,
    `  DockNode  ID=${hex(n.mid)} Parent=${hex(n.main)} SizeRef=${midW},${bodyH} Split=X`,
    `    DockNode  ID=${hex(n.centerCol)} Parent=${hex(n.mid)} SizeRef=${centerW},${bodyH} Split=Y`,
    `      DockNode  ID=${hex(n.center)} Parent=${hex(n.centerCol)} SizeRef=${centerW},${centerH} CentralNode=1`,
    `      DockNode  ID=${hex(n.bottom)} Parent=${hex(n.centerCol)} SizeRef=${centerW},${dims.bottomHeight}`,
    `    DockNode  ID=${hex(n.right)} Parent=${hex(n.mid)} SizeRef=${dims.rightWidth},${bodyH}`,
    '',
  ];

  return [...windowEntries, ...docking].join('\n');
};
