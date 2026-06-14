// Shared, mutable editor state for the studio shell. Panels read and write this;
// it stands in for what will eventually be engine resources (selection, play
// state, the active gizmo, editor preferences). Not wired to the engine yet.

import { type Scene } from './scene-data';

export type TransformTool = 'select' | 'move' | 'rotate' | 'scale';

export type AssetZoom = 'list' | 'sm' | 'md' | 'lg';

export interface ProjectSettings {
  renderer: string;
  colorSpace: string;
  targetFps: number;
  vsync: boolean;
  autosave: boolean;
  pixelScale: number;
  clearColor: string;
  renderLayer: string;
}

export interface StudioState {
  scene: Scene;
  /** Selected entity id, or `null`. Drives the inspector. */
  selected: string | null;
  playing: boolean;
  paused: boolean;
  tool: TransformTool;
  snap: boolean;
  gizmos: boolean;
  showProfiler: boolean;
  fps: number;
  /** Asset browser. */
  assetSearch: string;
  assetZoom: AssetZoom;
  /** Hierarchy filter. */
  entityFilter: string;
  /** Project Settings dialog. */
  settingsOpen: boolean;
  settings: ProjectSettings;
}

/** Build the studio's initial editor state around a scene. */
export const createState = (scene: Scene): StudioState => ({
  scene,
  selected: 'player',
  playing: false,
  paused: false,
  tool: 'move',
  snap: true,
  gizmos: true,
  showProfiler: false,
  fps: 60,
  assetSearch: '',
  assetZoom: 'md',
  entityFilter: '',
  settingsOpen: false,
  settings: {
    renderer: 'WebGPU',
    colorSpace: 'Linear',
    targetFps: 60,
    vsync: true,
    autosave: true,
    pixelScale: 2,
    clearColor: '#0B1110',
    renderLayer: 'Default',
  },
});

/** Count of enabled systems (drives the Systems tab badge + status bar). */
export const enabledSystems = (state: StudioState): number => state.scene.systems.filter((s) => s.on).length;

/** Sum of per-frame system cost (status bar + profiler footer). */
export const frameMs = (state: StudioState): number =>
  state.scene.systems.filter((s) => s.on).reduce((acc, s) => acc + s.ms, 0);

/** The asset preview tile size for the current zoom. */
export const tileFor = (zoom: AssetZoom): number => (zoom === 'lg' ? 120 : zoom === 'sm' ? 64 : zoom === 'list' ? 0 : 88);
