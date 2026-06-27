import type { AssetImporter } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';

import { SparseMorphTarget, parseSparseMorphTarget } from './sparse-morph-target';

/** Asset-kind tag for a sparse morph target (a MakeHuman `.target` file). */
export const SPARSE_MORPH_TARGET_ASSET_KIND = 'MorphTarget';

/** The {@link Assets} store holding imported {@link SparseMorphTarget} assets. */
export class SparseMorphTargets extends Assets<SparseMorphTarget> {}

/** The file stem (without directory or `.target` extension), used as the target name. */
const stemOf = (path: string): string => {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.target$/i, '');
};

/**
 * Importer for a MakeHuman `.target` file: decode the UTF-8 body and parse it
 * into a {@link SparseMorphTarget} named after the file stem. Index-vs-base
 * alignment is topology-locked data the file cannot self-check (it carries no
 * base-mesh reference), so it is validated when the target is composed onto a
 * concrete base mesh (`SparseMorphTarget.fitsBase` / `toDense`), not here.
 */
export const createSparseMorphTargetImporter = (): AssetImporter<SparseMorphTarget> => (bytes, ctx) =>
  parseSparseMorphTarget(new TextDecoder().decode(bytes), stemOf(ctx.path));
