import type { Color } from '@retro-engine/math';

/**
 * Global default clear color for cameras whose `clearColor` is
 * `ClearColorConfig.Default`. Inserted as a resource by `CameraPlugin` with
 * opaque black; replace via `app.insertResource(new ClearColor({...}))` to
 * change.
 *
 * Per-camera overrides take precedence: a camera with
 * `clearColor: ClearColorConfig.custom({...})` ignores this resource; a
 * camera with `clearColor: ClearColorConfig.None` does not clear at all.
 *
 * @example
 * ```ts
 * import { ClearColor } from '@retro-engine/engine';
 * app.insertResource(new ClearColor({ r: 0.05, g: 0.05, b: 0.08, a: 1 }));
 * ```
 */
export class ClearColor {
  color: Color;

  constructor(color: Color = { r: 0, g: 0, b: 0, a: 1 }) {
    this.color = color;
  }
}
