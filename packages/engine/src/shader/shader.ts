/**
 * A raw WGSL shader source paired with optional metadata.
 *
 * Today this is a plain value class — pass the WGSL string into the
 * constructor, hand the result to `PipelineCache.compileShader`, get back
 * a compiled `ShaderModule`. Once the asset system lands, `Shader` becomes
 * a typed asset and `ShaderRef` (`Default | Path | Handle`) becomes the
 * uniform way materials and the render graph reference shaders. The class
 * shape is the same in both worlds — the source string is the
 * payload either way.
 *
 * Pre-preprocessor: the source may contain `#import`, `#define`, and
 * `#ifdef`/`#ifndef`/`#else`/`#endif` directives (see
 * {@link preprocessWgsl}). The directives are stripped during compilation
 * and never reach the GPU.
 */
export class Shader {
  /** Raw WGSL source, pre-preprocessor. */
  readonly source: string;
  /** Optional label propagated to the backend's `ShaderModule` for debugging. */
  readonly label?: string;

  constructor(source: string, options?: { label?: string }) {
    this.source = source;
    if (options?.label !== undefined) this.label = options.label;
  }
}
