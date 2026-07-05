// Shared, mutable editor state for the studio shell. Panels read and write this;
// it stands in for what will eventually be engine resources (selection, play
// state, the active gizmo, editor preferences). Not wired to the engine yet.

import type { AssetSource } from '@retro-engine/assets';
import { type Entity } from '@retro-engine/ecs';
import { type AssetSelection, defaultViewportGizmoOptions, type ViewportGizmoOptions } from '@retro-engine/editor-sdk';

import { type AssetPickerState, createAssetPickerState } from './asset-picker/asset-picker-state';
import { type AssetsPanelState, createAssetsPanelState } from './assets/assets-panel-state';
import { type ComposerState, createComposerState } from './composer/composer-state';
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
  /**
   * Selected asset (material, etc.), or `null`. Mutually exclusive with
   * {@link selectedEntity}: setting one clears the other. When set, the inspector
   * shows the asset editor instead of the entity's components.
   */
  selectedAsset: AssetSelection | null;
  /** Entities the user has collapsed in the hierarchy (default expanded; rebuilt each frame). */
  collapsed: Set<Entity>;
  /** Entity being inline-renamed in the hierarchy, or `null`. Mutually exclusive with {@link entityDraft}. */
  renamingEntity: Entity | null;
  /**
   * An in-progress "create empty" — a virtual tree row with an editable name that
   * has no backing entity yet; committing spawns it under `parent` (root when `null`).
   * Mutually exclusive with {@link renamingEntity}.
   */
  entityDraft: { parent: Entity | null } | null;
  /** Shared buffer for the active hierarchy rename / draft field (only one at a time). */
  entityEditBuffer: string;
  /** One-shot: focus the hierarchy edit field next frame. */
  entityEditFocus: boolean;
  /** Reveal derived / non-serializable components in the inspector (a debug view). */
  debugMode: boolean;
  /** Last history cursor the panel rendered — drives auto-scroll only when it changes. */
  historyLastCurrent: number;
  /** Clear-history confirmation dialog is open. */
  historyClearConfirm: boolean;
  /**
   * History cursor (`view().currentIndex`) at the last save / load. The scene is
   * dirty when the live cursor differs from this — undoing back to it goes clean.
   */
  savedHistoryIndex: number;
  /** Whether the scene has unsaved edits — recomputed each frame from the history cursor vs {@link savedHistoryIndex}. */
  dirty: boolean;
  /** The Entity Composer modal (create / add / bundle) — its full transient + persisted state. */
  composer: ComposerState;
  /** The asset picker modal — the slot being assigned plus its transient browse state. */
  assetPicker: AssetPickerState;
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
  /** The open project's file reader, or `null` with no project open. Lets panels read loose project files (e.g. rig/weights JSON) by path. */
  assetSource: AssetSource | null;
  /** Asset browser panel state: search, zoom, folder, filters, expansion, multi-select. */
  assets: AssetsPanelState;
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
  selectedAsset: null,
  collapsed: new Set(),
  renamingEntity: null,
  entityDraft: null,
  entityEditBuffer: '',
  entityEditFocus: false,
  debugMode: false,
  historyLastCurrent: -1,
  historyClearConfirm: false,
  savedHistoryIndex: -1,
  dirty: false,
  composer: createComposerState(),
  assetPicker: createAssetPickerState(),
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
  assetSource: null,
  assets: createAssetsPanelState(),
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
