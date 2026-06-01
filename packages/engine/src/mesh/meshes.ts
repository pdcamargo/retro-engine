import { Assets } from '@retro-engine/assets';

import type { Mesh } from './mesh';

/**
 * App-level store mapping {@link import('@retro-engine/assets').Handle}s to
 * {@link Mesh} instances.
 *
 * Inserted as a main-world resource by {@link MeshPlugin}. Gameplay /
 * spawn-time code calls `meshes.add(mesh)` to register a mesh and get back a
 * `Handle<Mesh>`; downstream components hold the handle, not the mesh itself.
 * The store buffers lifecycle events (`added` / `modified` / `removed`) that
 * the `MeshPlugin` extract system drains once per frame and feeds into the
 * {@link MeshAllocator} on the render world.
 */
export class Meshes extends Assets<Mesh> {}
