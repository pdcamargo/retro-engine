import type { RenderTarget, ResolvedRenderTarget } from '@retro-engine/renderer-core';

/**
 * Resolve any {@link RenderTarget} variant to a {@link ResolvedRenderTarget}.
 *
 * For `surface` targets, acquires a fresh swapchain view — call once per frame
 * per camera. For `texture` targets, materialises a view per the descriptor.
 * For pre-built `view` targets, passes the caller-supplied metadata through.
 */
export const resolveRenderTargetImpl = (target: RenderTarget): ResolvedRenderTarget => {
  switch (target.kind) {
    case 'surface': {
      const { surface } = target;
      return {
        view: surface.getCurrentTextureView(),
        format: surface.format,
        width: surface.width,
        height: surface.height,
      };
    }
    case 'texture': {
      const { texture, viewDescriptor } = target;
      return {
        view: texture.createView(viewDescriptor),
        format: texture.format,
        width: texture.width,
        height: texture.height,
      };
    }
    case 'view': {
      return {
        view: target.view,
        format: target.format,
        width: target.width,
        height: target.height,
      };
    }
  }
};
