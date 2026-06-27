import type { AssetImporter } from '@retro-engine/assets';
import { Assets } from '@retro-engine/assets';

import { type ProxyFitting, parseMhclo } from './proxy-fitting';

/** Asset-kind tag for a garment proxy fitting (a MakeHuman `.mhclo` file). */
export const PROXY_FITTING_ASSET_KIND = 'ProxyFitting';

/** The {@link Assets} store holding imported {@link ProxyFitting} assets. */
export class ProxyFittings extends Assets<ProxyFitting> {}

/**
 * Importer for a MakeHuman `.mhclo` file: decode the UTF-8 body and parse it into
 * a {@link ProxyFitting}. The garment's own geometry (the `.obj` the fitting names
 * in `objFile`) loads separately through the `ObjMesh` kind; this asset carries
 * only the body-surface binding.
 */
export const createProxyFittingImporter = (): AssetImporter<ProxyFitting> => (bytes) =>
  parseMhclo(new TextDecoder().decode(bytes));
