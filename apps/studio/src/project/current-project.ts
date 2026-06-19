import type { PlatformHost } from '@retro-engine/editor-platform';

const PROJECT_KEY = 'retro.studio.project';

/**
 * The project directory the studio should open this session, or `null` for none.
 * A `?project=<dir>` query param wins (so a test/launcher can target one without
 * touching stored state); otherwise the persisted last-opened project is used.
 */
export const currentProjectDir = async (platform: PlatformHost): Promise<string | null> => {
  const fromUrl = new URLSearchParams(window.location.search).get('project');
  if (fromUrl !== null && fromUrl.length > 0) return fromUrl;
  return platform.preferences.get(PROJECT_KEY);
};

/** Persist the project to open, so the next studio session boots into it. */
export const setCurrentProjectDir = async (platform: PlatformHost, dir: string): Promise<void> => {
  await platform.preferences.set(PROJECT_KEY, dir);
};
