/** What the studio should do in response to a changed project file. */
export type WatchReaction = 'rebuild' | 'reload-scene' | 'reindex' | 'ignore';

const CODE = /\.(ts|tsx|js|jsx|mjs)$/i;
const SCENE = /\.(rescene|reprefab)$/i;
const ASSET = /\.(png|jpe?g|webp|ktx2|basis|glb|gltf|bin|ogg|mp3|wav|mp4|webm|rmesh)$/i;

/**
 * Classify a changed project file into the studio's reaction:
 * - code (`*.ts` …) → `rebuild` (re-bundle user code, then App-rebuild)
 * - scene/prefab (`*.rescene`/`*.reprefab`) → `reload-scene` (prompt; may clobber edits)
 * - `.meta` or a known asset binary → `reindex` (re-scan the manifest; reload by GUID)
 * - anything else → `ignore`
 * Code wins over the others so a renamed `.ts` is rebuilt, not mis-handled.
 */
export const classifyChange = (path: string): WatchReaction => {
  if (CODE.test(path)) return 'rebuild';
  if (SCENE.test(path)) return 'reload-scene';
  if (path.endsWith('.meta') || ASSET.test(path)) return 'reindex';
  return 'ignore';
};
