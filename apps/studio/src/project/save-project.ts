import type { AssetSink } from '@retro-engine/assets';
import type { App, SerializeProjectOptions } from '@retro-engine/engine';
import { serializeProject } from '@retro-engine/engine';

/**
 * Serialize the App's scenes (+ promoted assets) and write every file through
 * the project's sink — the save half of the project I/O. `serializeProject`
 * produces pure data (scenes as YAML, `.meta` sidecars, no committed manifest);
 * this loops over the files and writes them. Returns the saved scene identities.
 */
export const saveProject = async (
  app: App,
  sink: AssetSink,
  opts: SerializeProjectOptions,
): Promise<{ readonly files: number; readonly scenes: readonly { location: string; guid: string }[] }> => {
  const saved = serializeProject(app, opts);
  for (const file of saved.files) await sink.write(file.location, file.bytes);
  return { files: saved.files.length, scenes: saved.scenes };
};
