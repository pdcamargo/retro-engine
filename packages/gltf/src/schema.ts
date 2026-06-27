/**
 * TypeScript shapes for the glTF 2.0 JSON document — the v1 subset this loader
 * reads. Fields mirror the glTF 2.0 specification one-for-one and are all
 * optional where the spec allows omission. These are types only; mapping glTF
 * structures onto engine assets happens in a separate layer.
 */

/**
 * glTF accessor component type, as the numeric GL enum the spec uses:
 * `5120` BYTE, `5121` UNSIGNED_BYTE, `5122` SHORT, `5123` UNSIGNED_SHORT,
 * `5125` UNSIGNED_INT, `5126` FLOAT.
 */
export type GltfComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;

/** glTF accessor element type — the number of components per element. */
export type GltfAccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';

/** Alpha-coverage mode of a material. */
export type GltfAlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

/** Asset metadata block; `version` is the only required field. */
export interface GltfAsset {
  version: string;
  minVersion?: string;
  generator?: string;
  copyright?: string;
}

/** A block of raw bytes, referenced by its `uri` or — in a GLB — the BIN chunk. */
export interface GltfBuffer {
  /** Absent for the GLB BIN-chunk buffer; otherwise a relative URI or `data:` URI. */
  uri?: string;
  byteLength: number;
  name?: string;
}

/** A windowed, optionally strided view into a {@link GltfBuffer}. */
export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  /** Byte stride between consecutive elements; absent means tightly packed. */
  byteStride?: number;
  /** GL buffer target hint (`34962` ARRAY_BUFFER, `34963` ELEMENT_ARRAY_BUFFER). */
  target?: number;
  name?: string;
}

/** The replacement set of a sparse accessor. */
export interface GltfAccessorSparse {
  count: number;
  indices: {
    bufferView: number;
    byteOffset?: number;
    /** `5121`, `5123`, or `5125` — the width of each index. */
    componentType: GltfComponentType;
  };
  values: {
    bufferView: number;
    byteOffset?: number;
  };
}

/** Typed, structured view over a region of buffer data. */
export interface GltfAccessor {
  /** Absent when the accessor's base values are entirely zero (sparse-only). */
  bufferView?: number;
  byteOffset?: number;
  componentType: GltfComponentType;
  /** When true, integer values are read back as normalized floats. */
  normalized?: boolean;
  count: number;
  type: GltfAccessorType;
  max?: number[];
  min?: number[];
  sparse?: GltfAccessorSparse;
  name?: string;
}

/** A reference to a texture plus the UV set it samples. */
export interface GltfTextureInfo {
  index: number;
  texCoord?: number;
}

/** Texture reference for a normal map, with its tangent-space `scale`. */
export interface GltfNormalTextureInfo extends GltfTextureInfo {
  scale?: number;
}

/** Texture reference for occlusion, with its `strength`. */
export interface GltfOcclusionTextureInfo extends GltfTextureInfo {
  strength?: number;
}

/** The metallic-roughness PBR workflow parameters of a material. */
export interface GltfPbrMetallicRoughness {
  baseColorFactor?: [number, number, number, number];
  baseColorTexture?: GltfTextureInfo;
  metallicFactor?: number;
  roughnessFactor?: number;
  metallicRoughnessTexture?: GltfTextureInfo;
}

/** A surface appearance description. */
export interface GltfMaterial {
  pbrMetallicRoughness?: GltfPbrMetallicRoughness;
  normalTexture?: GltfNormalTextureInfo;
  occlusionTexture?: GltfOcclusionTextureInfo;
  emissiveTexture?: GltfTextureInfo;
  emissiveFactor?: [number, number, number];
  alphaMode?: GltfAlphaMode;
  alphaCutoff?: number;
  doubleSided?: boolean;
  name?: string;
}

/** One drawable piece of a {@link GltfMesh}: attributes, indices, and a material. */
export interface GltfPrimitive {
  /** Attribute semantic (`POSITION`, `NORMAL`, `TEXCOORD_0`, …) → accessor index. */
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  /** GL primitive mode; absent means `4` (triangles). */
  mode?: number;
  /** Morph-target attribute sets: each maps a semantic (`POSITION`/`NORMAL`) to a delta accessor. */
  targets?: Record<string, number>[];
}

/** A collection of primitives drawn together. */
export interface GltfMesh {
  primitives: GltfPrimitive[];
  /** Default morph-target weights, parallel to each primitive's `targets`. */
  weights?: number[];
  name?: string;
  /**
   * Exporter/application extras passed through from the source document. Morph
   * target names live at `extras.targetNames` (the de-facto glTF convention
   * Blender and other exporters write).
   */
  extras?: { targetNames?: string[] } & Record<string, unknown>;
}

/** An encoded image, referenced by `uri`, embedded `data:` URI, or `bufferView`. */
export interface GltfImage {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
  name?: string;
}

/** Texture filtering and wrapping parameters. */
export interface GltfSampler {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
  name?: string;
}

/** Pairs an image source with a sampler. */
export interface GltfTexture {
  sampler?: number;
  source?: number;
  name?: string;
}

/**
 * A node in the scene graph. Transform is either a single `matrix` or the
 * `translation`/`rotation`/`scale` triple; never both.
 */
export interface GltfNode {
  children?: number[];
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  mesh?: number;
  camera?: number;
  /** Index into {@link GltfDocument.skins}; present on a node that draws a skinned mesh. */
  skin?: number;
  /** Per-node morph-target weights (reserved; not consumed in v1). */
  weights?: number[];
  name?: string;
}

/**
 * A skin: the ordered set of joint nodes that deform a skinned mesh, plus the
 * inverse bind matrices that map mesh-space vertices into each joint's space.
 */
export interface GltfSkin {
  /** Node indices of the joints, in palette order. The i-th joint maps to the i-th inverse bind matrix. */
  joints: number[];
  /** Accessor of `count = joints.length` MAT4 inverse bind matrices; absent means all-identity. */
  inverseBindMatrices?: number;
  /** Node index of the common root of the joint hierarchy (a hint; not required to skin). */
  skeleton?: number;
  name?: string;
}

/** A set of root nodes that make up one renderable scene. */
export interface GltfScene {
  nodes?: number[];
  name?: string;
}

/**
 * How an {@link GltfAnimationSampler} interpolates between keyframes. Absent
 * means `LINEAR`. `CUBICSPLINE` stores three values per keyframe (in-tangent,
 * value, out-tangent) in its output accessor.
 */
export type GltfInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

/** The animated node property a channel targets. */
export interface GltfAnimationChannelTarget {
  /** Index into {@link GltfDocument.nodes}; absent for an undefined target (ignored). */
  node?: number;
  /** The property being animated. `weights` drives morph-target weights. */
  path: 'translation' | 'rotation' | 'scale' | 'weights';
}

/** Binds an {@link GltfAnimationSampler} to the node property it drives. */
export interface GltfAnimationChannel {
  /** Index into the parent animation's `samplers`. */
  sampler: number;
  target: GltfAnimationChannelTarget;
}

/**
 * Keyframe data for one animated property: an `input` accessor of timestamps and
 * an `output` accessor of values, blended by `interpolation`.
 */
export interface GltfAnimationSampler {
  /** Accessor index of the keyframe timestamps (SCALAR FLOAT, strictly increasing). */
  input: number;
  /** Accessor index of the keyframe values. */
  output: number;
  /** Interpolation mode; absent means `LINEAR`. */
  interpolation?: GltfInterpolation;
}

/** A named set of channels/samplers animating node properties over time. */
export interface GltfAnimation {
  channels: GltfAnimationChannel[];
  samplers: GltfAnimationSampler[];
  name?: string;
}

/** The root glTF JSON document. Every collection is optional per the spec. */
export interface GltfDocument {
  asset: GltfAsset;
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  animations?: GltfAnimation[];
  accessors?: GltfAccessor[];
  skins?: GltfSkin[];
  bufferViews?: GltfBufferView[];
  buffers?: GltfBuffer[];
  textures?: GltfTexture[];
  images?: GltfImage[];
  samplers?: GltfSampler[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}
