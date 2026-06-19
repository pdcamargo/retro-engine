import type { PreferenceStore } from '@retro-engine/editor-platform';

const PREFIX = 'retro.studio.project';

/**
 * Preference key for a piece of **per-project, personal** editor state (dock
 * layout, last open scene, selection), namespaced by the project's stable id.
 * It lives in the global preference store (the app config dir) — never in the
 * project tree — so it follows the user, not the repo (ADR-0091).
 */
export const projectStateKey = (projectId: string, name: string): string => `${PREFIX}.${projectId}.${name}`;

/** Read a per-project personal editor-state value. */
export const getProjectState = (
  prefs: PreferenceStore,
  projectId: string,
  name: string,
): Promise<string | null> => prefs.get(projectStateKey(projectId, name));

/** Write a per-project personal editor-state value. */
export const setProjectState = (
  prefs: PreferenceStore,
  projectId: string,
  name: string,
  value: string,
): Promise<void> => prefs.set(projectStateKey(projectId, name), value);
