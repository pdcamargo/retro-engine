/**
 * Per-camera opt-in marker for a screen-space depth prepass. When present on
 * a camera, the engine runs a depth-only pass before the opaque pass for that
 * camera, populating the camera's depth attachment ahead of shading.
 *
 * The depth target itself is allocated through the camera's normal
 * `depthTarget: 'auto'` path; this component does not allocate anything by
 * itself. Cameras spawned with `depthTarget: 'none'` cannot run a prepass.
 */
export class DepthPrepass {}

/**
 * Per-camera opt-in marker for a screen-space normal + roughness prepass.
 * Implies a depth prepass — depth must be bound for the pass to be valid.
 * When present, the engine allocates a per-camera `rgba16float` texture
 * (world-space normal in `.rgb`, perceptual roughness in `.a`) and binds it
 * as a color attachment of the prepass.
 */
export class NormalPrepass {}

/**
 * Per-camera opt-in marker for a screen-space motion-vector prepass. Implies
 * a depth prepass. When present, the engine allocates a per-camera
 * `rg16float` texture carrying the half-NDC delta from the previous frame's
 * projected position to the current frame's projected position. The
 * vertex stage reads each entity's previous-frame world matrix from a
 * sibling instance vertex buffer; the camera's previous view-proj is read
 * from the view uniform's `prev_view_proj` slot.
 */
export class MotionVectorPrepass {}

/**
 * The set of prepass outputs a given camera (or a given material) is
 * participating in. Each flag is independent: `depth` is the only one that
 * does not require its own dedicated texture (it shares the camera's depth
 * attachment); `normal` and `motionVector` each allocate one screen-space
 * color target.
 */
export interface PrepassFlags {
  readonly depth: boolean;
  readonly normal: boolean;
  readonly motionVector: boolean;
}

/** All-`false` flag triple — the default for materials that do not opt in. */
export const PREPASS_FLAGS_NONE: PrepassFlags = Object.freeze({
  depth: false,
  normal: false,
  motionVector: false,
});

/**
 * `true` iff at least one flag is set. A camera with `prepassFlagsAny` false
 * is treated as if it has no prepass markers and the prepass pipeline is
 * skipped entirely for that camera.
 */
export const prepassFlagsAny = (flags: PrepassFlags): boolean =>
  flags.depth || flags.normal || flags.motionVector;

/**
 * Intersect two flag triples — used to decide whether a material participates
 * in a camera's prepass (the material's `prepassWrites()` ∩ the camera's
 * enabled flags). If the intersection is empty, the material is skipped.
 */
export const intersectPrepassFlags = (a: PrepassFlags, b: PrepassFlags): PrepassFlags => ({
  depth: a.depth && b.depth,
  normal: a.normal && b.normal,
  motionVector: a.motionVector && b.motionVector,
});
