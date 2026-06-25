import { Assets } from '@retro-engine/engine';
import type { Handle, Image as ImageType, Mesh, StandardMaterial, Transform } from '@retro-engine/engine';
import type { Mat4 } from '@retro-engine/math';

/**
 * One drawable piece of a {@link GltfMesh}: the engine mesh it renders and the
 * material it draws with, if any. A primitive with no material maps to a node
 * (or child) entity that carries only a `Mesh3d` until a default material is
 * assigned by the consumer.
 */
export interface GltfPrimitive {
  readonly mesh: Handle<Mesh>;
  readonly material?: Handle<StandardMaterial>;
}

/** A glTF mesh — one or more primitives drawn under a single node. */
export interface GltfMesh {
  readonly primitives: readonly GltfPrimitive[];
  readonly name?: string;
}

/**
 * A node in the glTF scene graph: a local {@link Transform} (the glTF `matrix`
 * is decomposed to TRS at import), the indices of its child nodes, and an
 * optional reference into {@link Gltf.meshes}. `name` is absent when the source
 * node was unnamed; instantiation gives named nodes a `Name` component and
 * leaves unnamed ones without one.
 */
export interface GltfNode {
  readonly transform: Transform;
  readonly children: readonly number[];
  readonly mesh?: number;
  /** Index into {@link Gltf.skins}, present when this node draws a skinned mesh. */
  readonly skin?: number;
  readonly name?: string;
}

/**
 * A skin: the ordered joint nodes that deform a skinned mesh and the inverse
 * bind matrices that map mesh-space vertices into each joint's local space. The
 * i-th `joint` (a {@link Gltf.nodes} index) pairs with the i-th
 * `inverseBindMatrices` entry; instantiation resolves the joint indices to the
 * spawned bone entities.
 */
export interface GltfSkin {
  readonly joints: readonly number[];
  /** Parallel to {@link joints}; an all-identity list when the source omitted the accessor. */
  readonly inverseBindMatrices: readonly Mat4[];
  /** Node index of the joint hierarchy's common root, when the source provides one. */
  readonly skeleton?: number;
  readonly name?: string;
}

/** A set of root node indices that together make up one renderable scene. */
export interface GltfScene {
  readonly nodes: readonly number[];
  readonly name?: string;
}

/**
 * The asset a glTF (or GLB) file imports into: an inert, navigable description
 * of the document's scenes, nodes, and the engine assets its meshes/materials/
 * images decoded into. Bringing it into the world is the job of a
 * {@link GltfSceneRoot} component and the instantiation reactor, which mirror a
 * scene's node graph as an entity tree.
 *
 * Collections are indexed parallel to the source document; the `named*` maps
 * give name-keyed access (glTF names are not unique — the map keeps the first
 * occurrence in document order). `defaultScene` is the document's `scene`, if set.
 *
 * Animations are reserved for a later milestone and are not present in v1 imports.
 */
export interface Gltf {
  readonly scenes: readonly GltfScene[];
  readonly namedScenes: ReadonlyMap<string, GltfScene>;
  readonly defaultScene?: GltfScene;
  readonly meshes: readonly GltfMesh[];
  readonly namedMeshes: ReadonlyMap<string, GltfMesh>;
  readonly materials: readonly Handle<StandardMaterial>[];
  readonly namedMaterials: ReadonlyMap<string, Handle<StandardMaterial>>;
  readonly images: readonly Handle<ImageType>[];
  readonly nodes: readonly GltfNode[];
  readonly namedNodes: ReadonlyMap<string, GltfNode>;
  /** Skins indexed parallel to the source document; empty when the file has none. */
  readonly skins: readonly GltfSkin[];
}

/** The {@link Assets} store holding imported {@link Gltf} root assets. */
export class Gltfs extends Assets<Gltf> {}
