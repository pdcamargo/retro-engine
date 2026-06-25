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
  /**
   * Whether the backend supports a non-zero `baseVertex` parameter on
   * {@link RenderPassEncoder.drawIndexed}.
   *
   * `true` on WebGPU (every indexed draw can pick a base-vertex offset, which
   * is what lets the mesh allocator pack many meshes into one shared vertex
   * buffer). `false` on WebGL2 (`drawElements` has no such parameter), in
   * which case the engine falls back to one vertex buffer per mesh.
   */
  readonly baseVertex: boolean;
  /**
   * Whether the backend can bind storage buffers (`var<storage>`) to shaders.
   *
   * `true` on WebGPU. `false` on WebGL2, which has no shader storage buffer
   * objects at all — features that deliver bulk per-draw data through a storage
   * buffer (e.g. the GPU-skinning joint palette) must check this flag and fall
   * back to a storage-buffer-free path (a uniform array or a data texture)
   * where it is unset.
   */
  readonly storageBuffers: boolean;
}
