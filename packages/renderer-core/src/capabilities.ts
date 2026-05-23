/**
 * Optional capabilities that may or may not be supported by a given backend.
 *
 * Engine code must check these before using any feature gated on them — this
 * is how WebGL2-incompatible features are kept reachable from the engine layer
 * without forking the renderer at the type level.
 */
export interface RendererCapabilities {
  readonly computeShaders: boolean;
  readonly storageTextures: boolean;
  readonly timestampQueries: boolean;
  readonly indirectDraw: boolean;
  readonly bgra8UnormStorage: boolean;
}
