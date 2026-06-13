import { ImGui, ImGuiCol, ImVec2, ImVec4 } from '@mori2003/jsimgui';

import { resolveTheme } from './theme';
import type { ThemeTokens } from './tokens';
import type { Rgba, Vec2 } from './units';

const vec4 = (c: Rgba): ImVec4 => new ImVec4(c[0], c[1], c[2], c[3]);
const vec2 = (v: Vec2): ImVec2 => new ImVec2(v[0], v[1]);

/**
 * Apply design {@link ThemeTokens} to the active UI style. Mutates the shared
 * style state, so it persists until called again — call once after the overlay
 * is initialized, and again whenever the tokens change.
 *
 * Requires an initialized UI context; calling it before the overlay's `init()`
 * has resolved has no useful effect.
 */
export const applyTheme = (tokens: ThemeTokens): void => {
  const t = resolveTheme(tokens);
  const style = ImGui.GetStyle();

  style.WindowRounding = t.metrics.windowRounding;
  style.FrameRounding = t.metrics.frameRounding;
  style.GrabRounding = t.metrics.grabRounding;
  style.WindowBorderSize = t.metrics.borderSize;
  style.WindowPadding = vec2(t.metrics.windowPadding);
  style.FramePadding = vec2(t.metrics.framePadding);
  style.ItemSpacing = vec2(t.metrics.itemSpacing);

  const c = t.color;
  const colors = style.Colors;
  colors[ImGuiCol.Text] = vec4(c.text);
  colors[ImGuiCol.WindowBg] = vec4(c.surface);
  colors[ImGuiCol.ChildBg] = vec4(c.surface);
  colors[ImGuiCol.PopupBg] = vec4(c.surface);
  colors[ImGuiCol.TitleBg] = vec4(c.title);
  colors[ImGuiCol.TitleBgActive] = vec4(c.titleActive);
  colors[ImGuiCol.TitleBgCollapsed] = vec4(c.title);
  colors[ImGuiCol.FrameBg] = vec4(c.field);
  colors[ImGuiCol.FrameBgHovered] = vec4(c.fieldHovered);
  colors[ImGuiCol.FrameBgActive] = vec4(c.fieldHovered);
  colors[ImGuiCol.Button] = vec4(c.accent);
  colors[ImGuiCol.ButtonHovered] = vec4(c.accentHovered);
  colors[ImGuiCol.ButtonActive] = vec4(c.accentActive);
  colors[ImGuiCol.Header] = vec4(c.accent);
  colors[ImGuiCol.HeaderHovered] = vec4(c.accentHovered);
  colors[ImGuiCol.HeaderActive] = vec4(c.accentActive);
  colors[ImGuiCol.CheckMark] = vec4(c.indicator);
  colors[ImGuiCol.SliderGrab] = vec4(c.indicator);
  colors[ImGuiCol.SliderGrabActive] = vec4(c.indicator);
  colors[ImGuiCol.Border] = vec4(c.border);
  colors[ImGuiCol.Separator] = vec4(c.border);
  style.Colors = colors;
};
