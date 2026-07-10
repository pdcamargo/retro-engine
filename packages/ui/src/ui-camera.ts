/**
 * Marker component opting a camera into hosting the in-game UI. When present on a
 * camera entity, {@link import('./render/ui-render-plugin').UiRenderPlugin} draws
 * the UI into that camera's render target (the swapchain for a primary camera, or
 * an offscreen texture for a texture camera), sized to that target, instead of the
 * default full-surface overlay.
 *
 * Attach it to the camera whose output should carry the UI (typically the 2D / UI
 * camera). At most one UI camera is honored per frame; if several are marked, the
 * one that is also the main camera wins, otherwise the first in dispatch order.
 */
export class UiCamera {}
