import type { Query as QueryHandle } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';

import type { App } from '../index';
import { packInstanceTransform } from '../material/instance-layout';
import type { AllocatorSlice, MeshHandle, RenderMesh } from '../mesh';
import { MeshAllocator, Mesh3d, RenderMeshes } from '../mesh';
import { PipelineCache } from '../shader/pipeline-cache';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import { Shadow3dState } from './shadow-3d';
import { Shadow3dSettings } from './shadow-3d-settings';

/** Query over shadow-casting meshes (visible `Mesh3d` without `NotShadowCaster`). */
export type ShadowCasterQuery = QueryHandle<
  readonly [typeof Mesh3d, typeof GlobalTransform, typeof ViewVisibility]
>;

interface CasterGroup {
  readonly models: Mat4[];
  readonly renderMesh: RenderMesh;
  readonly vertexSlice: AllocatorSlice;
  readonly indexSlice: AllocatorSlice | undefined;
}

/**
 * Collect this frame's shadow casters and pack them for the shadow pass.
 *
 * Iterates every visible `Mesh3d` not marked `NotShadowCaster` (the query
 * filter is applied by the caller), groups by mesh handle, packs each group's
 * world transforms contiguously into the shared shadow instance buffer, and
 * records one {@link Shadow3dState.casterBatches} entry per group with its
 * depth-only pipeline. The same batches are drawn into every shadow-casting
 * light's atlas layer by `Shadow3dPass3dNode`.
 *
 * No-op when no light casts a shadow this frame, or before the shadow GPU
 * bootstrap completes.
 *
 * @internal
 */
export const queueShadow3dCasters = (
  app: App,
  casters: ShadowCasterQuery,
  renderMeshes: RenderMeshes,
  allocator: MeshAllocator,
  shadow: Shadow3dState,
  settings: Shadow3dSettings,
): void => {
  if (shadow.shadowLightCount === 0 || shadow.atlasTexture === undefined) return;
  const pipelineCache = app.getResource(PipelineCache);
  if (pipelineCache === undefined) return;

  const groups = new Map<MeshHandle, CasterGroup>();
  for (const row of casters.entries()) {
    if (!(row[3] as ViewVisibility).visible) continue;
    const mesh3d = row[1] as Mesh3d;
    const gt = row[2] as GlobalTransform;

    let group = groups.get(mesh3d.handle);
    if (group === undefined) {
      const renderMesh = renderMeshes.get(mesh3d.handle);
      if (renderMesh === undefined) continue;
      const vertexSlice = allocator.vertexSlice(mesh3d.handle);
      if (vertexSlice === undefined) continue;
      let indexSlice: AllocatorSlice | undefined;
      if (renderMesh.bufferInfo.kind === 'indexed') {
        indexSlice = allocator.indexSlice(mesh3d.handle);
        if (indexSlice === undefined) continue;
      }
      group = { models: [], renderMesh, vertexSlice, indexSlice };
      groups.set(mesh3d.handle, group);
    }
    group.models.push(gt.matrix as Mat4);
  }
  if (groups.size === 0) return;

  let total = 0;
  for (const group of groups.values()) total += group.models.length;
  shadow.instanceBuffer.ensureCapacity(app.renderer, total);
  const scratch = shadow.instanceBuffer.scratchF32;

  let cursorFloats = 0;
  let cursorInstances = 0;
  for (const group of groups.values()) {
    const firstInstance = cursorInstances;
    for (const model of group.models) {
      cursorFloats += packInstanceTransform(scratch, cursorFloats, model);
      cursorInstances += 1;
    }
    shadow.casterBatches.push({
      pipeline: shadow.pipelineFor(
        pipelineCache as PipelineCache,
        group.renderMesh.layout.layout,
        group.renderMesh.primitiveTopology,
        settings,
      ),
      vertexSlice: group.vertexSlice,
      indexSlice: group.indexSlice,
      renderMesh: group.renderMesh,
      firstInstance,
      count: group.models.length,
    });
  }

  shadow.instanceBuffer.count = total;
  const buffer = shadow.instanceBuffer.buffer;
  if (buffer !== undefined && cursorFloats > 0) {
    app.renderer.writeBuffer(buffer, 0, scratch.subarray(0, cursorFloats) as unknown as BufferSource);
  }
};
