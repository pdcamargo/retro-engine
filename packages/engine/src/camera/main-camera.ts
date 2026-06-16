/**
 * Marker for the camera that represents the primary game view — the one a
 * player sees through, and that a host (such as an editor) drives into its main
 * viewport. A scene is expected to carry at most one.
 *
 * This is a *designation*, not a render input: the render loop never consults
 * it (which camera draws where is governed by {@link Camera.target},
 * {@link Camera.order}, and {@link Camera.isActive}). It exists so tooling and
 * gameplay code can locate the principal camera by a stable query rather than
 * by name or render order.
 *
 * @example
 * ```ts
 * cmd.spawn(...Camera3d({ hdr: true }), new MainCamera(), new Name('Main Camera'));
 * ```
 */
export class MainCamera {}
