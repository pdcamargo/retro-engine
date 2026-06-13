import { ImGui, ImGuiCol, ImVec2, ImVec4 } from '@mori2003/jsimgui';

import { resolveTheme } from './theme';
import type { ThemeTokens } from './tokens';
import type { Srgb8, Vec2 } from './units';

const color = (c: Srgb8, alpha = 1): ImVec4 => new ImVec4(c[0] / 255, c[1] / 255, c[2] / 255, alpha);
const vec2 = (v: Vec2): ImVec2 => new ImVec2(v[0], v[1]);

/**
 * Apply design {@link ThemeTokens} to the active UI style — every `ImGuiCol_`
 * slot plus the spacing / border / rounding / alignment style vars. Mutates the
 * shared style state, so it persists until called again; call once after the
 * overlay is initialized, and again whenever the tokens change.
 *
 * The slot mapping encodes the design system's opinions: phosphor green appears
 * only as a highlight (checkmarks, grabs, selection fills, the selected-tab
 * overline, nav, docking preview), surfaces step up the neutral ramp on hover
 * then active, depth comes from 1px borders rather than shadows, and the
 * selected tab reads as the panel body it opens.
 *
 * Requires an initialized UI context; calling it before the overlay's `init()`
 * has resolved has no useful effect.
 */
export const applyTheme = (tokens: ThemeTokens): void => {
  const { palette: p, metrics: m } = resolveTheme(tokens);
  const style = ImGui.GetStyle();

  // Spacing & sizing.
  style.WindowPadding = vec2(m.windowPadding);
  style.FramePadding = vec2(m.framePadding);
  style.CellPadding = vec2(m.cellPadding);
  style.ItemSpacing = vec2(m.itemSpacing);
  style.ItemInnerSpacing = vec2(m.itemInnerSpacing);
  style.IndentSpacing = m.indentSpacing;
  style.ScrollbarSize = m.scrollbarSize;
  style.GrabMinSize = m.grabMinSize;

  // Borders (1px structure; tab overline accents the selected tab).
  style.WindowBorderSize = m.borderSize;
  style.ChildBorderSize = m.borderSize;
  style.PopupBorderSize = m.borderSize;
  style.FrameBorderSize = m.borderSize;
  style.TabBorderSize = m.tabBorderSize;
  style.TabBarOverlineSize = m.tabBarOverlineSize;
  style.SeparatorTextBorderSize = m.separatorTextBorderSize;

  // Rounding (kept sharp).
  style.WindowRounding = m.windowRounding;
  style.ChildRounding = m.childRounding;
  style.FrameRounding = m.frameRounding;
  style.PopupRounding = m.popupRounding;
  style.ScrollbarRounding = m.scrollbarRounding;
  style.GrabRounding = m.grabRounding;
  style.TabRounding = m.tabRounding;

  // Alignment.
  style.WindowTitleAlign = vec2(m.windowTitleAlign);
  style.ButtonTextAlign = vec2(m.buttonTextAlign);
  style.SelectableTextAlign = vec2(m.selectableTextAlign);

  const c = style.Colors;

  // Text.
  c[ImGuiCol.Text] = color(p.text);
  c[ImGuiCol.TextDisabled] = color(p.textFaint);
  c[ImGuiCol.TextLink] = color(p.cyan400);
  c[ImGuiCol.TextSelectedBg] = color(p.green400, 0.28);
  c[ImGuiCol.TreeLines] = color(p.gray6);

  // Windows & popups.
  c[ImGuiCol.WindowBg] = color(p.gray1);
  c[ImGuiCol.ChildBg] = color(p.gray0, 0);
  c[ImGuiCol.PopupBg] = color(p.gray2, 0.98);
  c[ImGuiCol.Border] = color(p.gray6);
  c[ImGuiCol.BorderShadow] = color(p.gray0, 0);
  c[ImGuiCol.MenuBarBg] = color(p.gray3);

  // Title bar.
  c[ImGuiCol.TitleBg] = color(p.gray3);
  c[ImGuiCol.TitleBgActive] = color(p.titleActive);
  c[ImGuiCol.TitleBgCollapsed] = color(p.gray2, 0.85);

  // Frame bg (checkbox / radio / slider / input / plot).
  c[ImGuiCol.FrameBg] = color(p.gray4);
  c[ImGuiCol.FrameBgHovered] = color(p.gray5);
  c[ImGuiCol.FrameBgActive] = color(p.gray6);

  // Scrollbar.
  c[ImGuiCol.ScrollbarBg] = color(p.gray0, 0);
  c[ImGuiCol.ScrollbarGrab] = color(p.gray6);
  c[ImGuiCol.ScrollbarGrabHovered] = color(p.gray7);
  c[ImGuiCol.ScrollbarGrabActive] = color(p.gray8);

  // Widget accents.
  c[ImGuiCol.CheckMark] = color(p.green400);
  c[ImGuiCol.SliderGrab] = color(p.green600);
  c[ImGuiCol.SliderGrabActive] = color(p.green400);

  // Buttons (neutral; push green per-widget for primary actions).
  c[ImGuiCol.Button] = color(p.gray4);
  c[ImGuiCol.ButtonHovered] = color(p.gray5);
  c[ImGuiCol.ButtonActive] = color(p.gray6);

  // Headers — CollapsingHeader / TreeNode / Selectable / MenuItem (selection).
  c[ImGuiCol.Header] = color(p.green400, 0.16);
  c[ImGuiCol.HeaderHovered] = color(p.green400, 0.1);
  c[ImGuiCol.HeaderActive] = color(p.green400, 0.24);

  // Separator.
  c[ImGuiCol.Separator] = color(p.gray6);
  c[ImGuiCol.SeparatorHovered] = color(p.green400, 0.6);
  c[ImGuiCol.SeparatorActive] = color(p.green400);

  // Resize grip.
  c[ImGuiCol.ResizeGrip] = color(p.gray7, 0.6);
  c[ImGuiCol.ResizeGripHovered] = color(p.green400, 0.7);
  c[ImGuiCol.ResizeGripActive] = color(p.green400);

  // Tabs — selected tab reads as the panel body; green overline.
  c[ImGuiCol.Tab] = color(p.gray3);
  c[ImGuiCol.TabHovered] = color(p.gray5);
  c[ImGuiCol.TabSelected] = color(p.gray2);
  c[ImGuiCol.TabSelectedOverline] = color(p.green400);
  c[ImGuiCol.TabDimmed] = color(p.gray2);
  c[ImGuiCol.TabDimmedSelected] = color(p.gray2);
  c[ImGuiCol.TabDimmedSelectedOverline] = color(p.gray7);

  // Docking.
  c[ImGuiCol.DockingPreview] = color(p.green400, 0.4);
  c[ImGuiCol.DockingEmptyBg] = color(p.gray0);

  // Plots.
  c[ImGuiCol.PlotLines] = color(p.cyan400);
  c[ImGuiCol.PlotLinesHovered] = color(p.amber500);
  c[ImGuiCol.PlotHistogram] = color(p.green400);
  c[ImGuiCol.PlotHistogramHovered] = color(p.green300);

  // Tables.
  c[ImGuiCol.TableHeaderBg] = color(p.gray3);
  c[ImGuiCol.TableBorderStrong] = color(p.gray7);
  c[ImGuiCol.TableBorderLight] = color(p.borderSubtle);
  c[ImGuiCol.TableRowBg] = color(p.gray0, 0);
  c[ImGuiCol.TableRowBgAlt] = color(p.white, 0.02);

  // Drag & drop.
  c[ImGuiCol.DragDropTarget] = color(p.amber400, 0.9);

  // Navigation & modal.
  c[ImGuiCol.NavCursor] = color(p.green400);
  c[ImGuiCol.NavWindowingHighlight] = color(p.white, 0.7);
  c[ImGuiCol.NavWindowingDimBg] = color(p.gray0, 0.4);
  c[ImGuiCol.ModalWindowDimBg] = color(p.modalDim, 0.72);

  style.Colors = c;
};
