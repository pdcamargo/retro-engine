import type { AssetIndex, Handle } from '@retro-engine/assets';

import type { Material } from './material';
import type { PreparedMaterial } from './prepare-bind-group';

/**
 * Render-world mirror of {@link Materials} for one material type `M`.
 *
 * Populated by `MaterialPlugin<M>`'s prepare system: for each `added` /
 * `modified` event drained from the material store, the prepare system runs
 * {@link prepareBindGroup} and stores the resulting {@link PreparedMaterial}
 * under the source handle's index. Removed handles drop their entry and
 * destroy the associated bind group + uniform buffer.
 *
 * Draw systems read this map to find a material's GPU bind group at draw
 * time. The bind group lives at `@group(2)` in every material pipeline. Keyed
 * on `handle.index` so lookups stay numeric on the draw hot path.
 */
export class RenderMaterials<M extends Material> {
  private readonly entries = new Map<AssetIndex, PreparedMaterial>();

  set(handle: Handle<M>, prepared: PreparedMaterial): void {
    this.entries.set(handle.index, prepared);
  }

  get(handle: Handle<M>): PreparedMaterial | undefined {
    return this.entries.get(handle.index);
  }

  has(handle: Handle<M>): boolean {
    return this.entries.has(handle.index);
  }

  delete(handle: Handle<M>): boolean {
    const entry = this.entries.get(handle.index);
    if (entry === undefined) return false;
    entry.bindGroup.destroy();
    entry.uniformBuffer?.destroy();
    return this.entries.delete(handle.index);
  }

  get size(): number {
    return this.entries.size;
  }
}
