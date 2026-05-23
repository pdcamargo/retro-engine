/** A compiled shader module. */
export interface ShaderModule {
  destroy(): void;
}

export interface ShaderModuleDescriptor {
  /** Source code (WGSL for WebGPU; GLSL ES for the future WebGL2 backend). */
  code: string;
  label?: string;
}
