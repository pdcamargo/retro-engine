// Shared, mutable editor state for the studio shell. Panels read and write this;
// it stands in for what will eventually be engine resources (selection, play
// state, the active gizmo, editor preferences). Not wired to the engine yet.

import { type Entity } from '@retro-engine/ecs';
import { defaultViewportGizmoOptions, type ViewportGizmoOptions } from '@retro-engine/editor-sdk';

import { type ViewMode } from './editor-camera';
import type { ProjectBrowser } from './project/project-browser';
import { type Scene } from './scene-data';

export type TransformTool = 'select' | 'move' | 'rotate' | 'scale' | 'all';

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
  /** Selected item in the mock asset browser, or `null`. */
  selected: string | null;
  /** Selected entity in the live ECS world, or `null`. Drives the hierarchy + inspector. */
  selectedEntity: Entity | null;
  /** Entities the user has collapsed in the hierarchy (default expanded; rebuilt each frame). */
  collapsed: Set<Entity>;
  /** Reveal derived / non-serializable components in the inspector (a debug view). */
  debugMode: boolean;
  /** Last history cursor the panel rendered — drives auto-scroll only when it changes. */
  historyLastCurrent: number;
  /** Clear-history confirmation dialog is open. */
  historyClearConfirm: boolean;
  /** Mirror of the engine's {@link SimState}: true in Play or Paused. Synced each frame from the App. */
  playing: boolean;
  /** Mirror of {@link SimState}: true only when play mode is paused. */
  paused: boolean;
  /** Scene viewport projection: orthographic 2D or perspective 3D. */
  viewMode: ViewMode;
  tool: TransformTool;
  snap: boolean;
  /** Grid snap increment in world units, surfaced by the snap toggle / grid settings. */
  snapStep: number;
  gizmos: boolean;
  showProfiler: boolean;
  fps: number;
  /** Live project asset browser (file index + thumbnails), or `null` with no project open. */
  browser: ProjectBrowser | null;
  /** Asset browser. */
  assetSearch: string;
  assetZoom: AssetZoom;
  /** Hierarchy filter. */
  entityFilter: string;
  /** Project Settings dialog. */
  settingsOpen: boolean;
  settings: ProjectSettings;
  /** Live appearance + behavior config for the Scene viewport orientation gizmo. */
  viewportGizmo: ViewportGizmoOptions;
}

/** Build the studio's initial editor state around a scene. */
export const createState = (scene: Scene): StudioState => ({
  scene,
  selected: null,
  selectedEntity: null,
  collapsed: new Set(),
  debugMode: false,
  historyLastCurrent: -1,
  historyClearConfirm: false,
  playing: false,
  paused: false,
  viewMode: '3d',
  tool: 'move',
  snap: true,
  snapStep: 1,
  gizmos: true,
  showProfiler: false,
  fps: 60,
  browser: null,
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
  viewportGizmo: defaultViewportGizmoOptions(),
});

/** The asset preview tile size for the current zoom. */
export const tileFor = (zoom: AssetZoom): number => (zoom === 'lg' ? 120 : zoom === 'sm' ? 64 : zoom === 'list' ? 0 : 88);
