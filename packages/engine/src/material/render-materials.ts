import type { Material } from './material';
import type { MaterialHandle } from './materials';
import type { PreparedMaterial } from './prepare-bind-group';

/**
 * Render-world mirror of {@link Materials} for one material type `M`.
 *
 * Populated by `MaterialPlugin<M>`'s prepare system: for each `Added` /
 * `Modified` event drained from `Materials<M>.drainPendingChanges`, the
 * prepare system runs {@link prepareBindGroup} and stores the resulting
 * {@link PreparedMaterial} under the source handle. Removed handles drop
 * their entry and destroy the associated bind group + uniform buffer.
 *
 * Draw systems read this map to find a material's GPU bind group at draw
 * time. The bind group lives at `@group(2)` in every material pipeline.
 */
export class RenderMaterials<M extends Material> {
  private readonly entries = new Map<MaterialHandle<M>, PreparedMaterial>();

  set(handle: MaterialHandle<M>, prepared: PreparedMaterial): void {
    const existing = this.entries.get(handle);
    if (existing !== undefined && existing !== prepared) {
      // Destroying the old bind group is the prepare path's responsibility
      // (it threads `previous` into `prepareBindGroup`). We just overwrite.
    }
    this.entries.set(handle, prepared);
  }

  get(handle: MaterialHandle<M>): PreparedMaterial | undefined {
    return this.entries.get(handle);
  }

  has(handle: MaterialHandle<M>): boolean {
    return this.entries.has(handle);
  }

  delete(handle: MaterialHandle<M>): boolean {
    const entry = this.entries.get(handle);
    if (entry === undefined) return false;
    entry.bindGroup.destroy();
    entry.uniformBuffer?.destroy();
    return this.entries.delete(handle);
  }

  get size(): number {
    return this.entries.size;
  }
}
