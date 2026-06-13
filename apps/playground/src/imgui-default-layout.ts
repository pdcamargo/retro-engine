// Default dock layout for the ?mode=imgui proving ground: Hierarchy docked on the
// left, Inspector + Console tabbed in the central node, Demo floating. This is a
// Dear ImGui `ini` string captured from a live arrangement via
// `window.__imguiSaveLayout()` (see imgui-showcase-plugin.ts) and baked here so the
// editor opens pre-docked. Whitespace is significant — it is ImGui's own output.
export const DEFAULT_IMGUI_LAYOUT = `[Window][WindowOverViewport_11111111]
Pos=0,0
Size=1200,762
Collapsed=0

[Window][Hierarchy]
Pos=0,0
Size=280,762
Collapsed=0
DockId=0x00001001,0

[Window][Inspector]
Pos=282,0
Size=918,762
Collapsed=0
DockId=0x00001002,0

[Window][Console]
Pos=282,0
Size=918,762
Collapsed=0
DockId=0x00001002,1

[Window][Dear ImGui Demo]
Pos=650,20
Size=550,680
Collapsed=0

[Docking][Data]
DockSpace   ID=0x08BD597D Window=0x1BBC0F80 Pos=0,0 Size=1200,762 Split=X
  DockNode  ID=0x00001001 Parent=0x08BD597D SizeRef=280,762 Selected=0xBABDAE5E
  DockNode  ID=0x00001002 Parent=0x08BD597D SizeRef=916,762 CentralNode=1 Selected=0x36DC96AB
`;
