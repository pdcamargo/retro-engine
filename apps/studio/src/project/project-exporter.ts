import { isTauri } from '@retro-engine/editor-platform';

/** Summary of a completed web export. */
export interface WebExportResult {
  /** Absolute output directory the artifact was written into (`<project>/dist/web`). */
  readonly outDir: string;
  /** Absolute paths of the files the export produced. */
  readonly outputs: readonly string[];
}

/**
 * Export the open project to a deployable static web build (`index.html` +
 * `main.js` + `assets.rpak` + `manifest.json`). Runs natively through the Tauri
 * `project_export_web` command (Bun sidecar); in a plain browser it hits the dev
 * server's `/project/export-web` route. The Tauri API is lazy-imported so a
 * plain-browser bundle never pulls it onto its boot path (ADR-0078).
 */
export const exportProjectWeb = async (
  projectDir: string,
  production = false,
): Promise<WebExportResult> => {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const json = await invoke<string>('project_export_web', { projectDir, production });
    return JSON.parse(json) as WebExportResult;
  }
  const query = `dir=${encodeURIComponent(projectDir)}${production ? '&production=1' : ''}`;
  const res = await fetch(`/project/export-web?${query}`);
  if (!res.ok) {
    throw new Error(`web export failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as WebExportResult;
};
