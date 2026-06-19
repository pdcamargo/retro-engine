// Demo scene model for the editor shell. This is fake authoring data — a stand-in
// for live ECS world state — so the studio's panels can be built and matched
// against the design handoff before they are wired to the engine. Values are
// mutable so the inspector's edit widgets round-trip into this model.

import type { AssetType, IconName } from '@retro-engine/editor-sdk';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type InspectorField =
  | { kind: 'vec3'; label: string; value: Vec3; suffix?: string; step?: number }
  | { kind: 'number'; label: string; value: number; suffix?: string; step?: number }
  | { kind: 'slider'; label: string; value: number; min: number; max: number; step?: number }
  | { kind: 'color'; label: string; value: string }
  | { kind: 'switch'; label: string; value: boolean }
  | { kind: 'enum'; label: string; value: string; options: string[] }
  | { kind: 'asset'; label: string; value: string };

export interface ComponentModel {
  type: string;
  icon: IconName;
  fields: InspectorField[];
}

export interface Entity {
  id: string;
  name: string;
  icon: IconName;
  depth: number;
  group?: boolean;
  parent?: string;
  open: boolean;
  visible: boolean;
}

export interface SpriteSub {
  name: string;
}

export interface AssetItem {
  name: string;
  type: AssetType;
  meta?: string;
  error?: boolean;
  subs?: SpriteSub[];
  expanded?: boolean;
}

export type ConsoleLevel = 'cmd' | 'info' | 'warn' | 'err';

export interface ConsoleLine {
  time: string;
  lvl: ConsoleLevel;
  text: string;
  meta?: string;
}

export interface Scene {
  entities: Entity[];
  components: Record<string, ComponentModel[]>;
  assets: AssetItem[];
  console: ConsoleLine[];
}

/** The demo scene used by the editor shell (mirrors the design handoff). */
export const createScene = (): Scene => ({
  entities: [
    { id: 'scene', name: 'main.scene', icon: 'clapperboard', depth: 0, group: true, open: true, visible: true },
    { id: 'player', name: 'Player', icon: 'box', depth: 1, parent: 'scene', open: true, visible: true },
    { id: 'camera', name: 'Main Camera', icon: 'video', depth: 1, parent: 'scene', open: true, visible: true },
    { id: 'ground', name: 'Ground', icon: 'grid-3x3', depth: 1, parent: 'scene', open: true, visible: true },
    { id: 'sun', name: 'Sun Light', icon: 'sun', depth: 1, parent: 'scene', open: true, visible: true },
    { id: 'enemies', name: 'Enemies', icon: 'folder', depth: 1, parent: 'scene', group: true, open: true, visible: true },
    { id: 'slime', name: 'Slime', icon: 'box', depth: 2, parent: 'enemies', open: true, visible: true },
    { id: 'bat', name: 'Bat', icon: 'box', depth: 2, parent: 'enemies', open: true, visible: true },
  ],

  components: {
    player: [
      {
        type: 'Transform',
        icon: 'move-3d',
        fields: [
          { kind: 'vec3', label: 'Position', value: { x: 0, y: 1.5, z: -2.4 }, suffix: 'm', step: 0.1 },
          { kind: 'vec3', label: 'Rotation', value: { x: 0, y: 45, z: 0 }, suffix: '°', step: 1 },
          { kind: 'vec3', label: 'Scale', value: { x: 1, y: 1, z: 1 }, step: 0.05 },
        ],
      },
      {
        type: 'Sprite',
        icon: 'image',
        fields: [
          { kind: 'asset', label: 'Texture', value: 'player_idle.png' },
          { kind: 'color', label: 'Tint', value: '#34E07A' },
          { kind: 'slider', label: 'Opacity', value: 1, min: 0, max: 1, step: 0.01 },
          { kind: 'switch', label: 'Flip X', value: false },
        ],
      },
      {
        type: 'RigidBody',
        icon: 'circle-dot',
        fields: [
          { kind: 'enum', label: 'Body', value: 'Dynamic', options: ['Dynamic', 'Kinematic', 'Static'] },
          { kind: 'number', label: 'Mass', value: 4, suffix: 'kg', step: 0.1 },
          { kind: 'switch', label: 'Gravity', value: true },
        ],
      },
      {
        type: 'Velocity',
        icon: 'gauge',
        fields: [{ kind: 'vec3', label: 'Linear', value: { x: 0, y: 0, z: 0 }, step: 0.1 }],
      },
    ],
    ground: [
      {
        type: 'Transform',
        icon: 'move-3d',
        fields: [
          { kind: 'vec3', label: 'Position', value: { x: 0, y: 0, z: 0 }, suffix: 'm', step: 0.1 },
          { kind: 'vec3', label: 'Scale', value: { x: 24, y: 1, z: 24 }, step: 0.5 },
        ],
      },
      {
        type: 'Collider',
        icon: 'box-select',
        fields: [{ kind: 'enum', label: 'Shape', value: 'Box', options: ['Box', 'Sphere', 'Mesh'] }],
      },
    ],
    sun: [
      {
        type: 'Transform',
        icon: 'move-3d',
        fields: [{ kind: 'vec3', label: 'Rotation', value: { x: -50, y: 30, z: 0 }, suffix: '°', step: 1 }],
      },
      {
        type: 'DirectionalLight',
        icon: 'sun',
        fields: [
          { kind: 'color', label: 'Color', value: '#FFD166' },
          { kind: 'slider', label: 'Intensity', value: 1.4, min: 0, max: 4, step: 0.1 },
          { kind: 'switch', label: 'Cast shadows', value: true },
        ],
      },
    ],
  },

  assets: [
    {
      name: 'characters.png',
      type: 'texture',
      meta: '128×128',
      subs: [{ name: 'hero' }, { name: 'coin' }, { name: 'slime' }, { name: 'bat' }],
    },
    { name: 'crate.png', type: 'texture', meta: '512×512' },
    { name: 'grass.png', type: 'texture', meta: '512×512' },
    { name: 'bricks.png', type: 'image', meta: '512×512' },
    { name: 'brass.mat', type: 'material' },
    { name: 'water.wgsl', type: 'shader' },
    { name: 'dusk.sky', type: 'skybox' },
    { name: 'valley.terrain', type: 'terrain' },
    { name: 'hero.fbx', type: 'mesh', meta: '4.2k tris' },
    { name: 'town.glb', type: 'model', meta: '18k tris' },
    { name: 'crystal.fbx', type: 'mesh', meta: '120 tris' },
    { name: 'level_01.scene', type: 'scene' },
    { name: 'enemy.prefab', type: 'prefab' },
    { name: 'movement.ts', type: 'script' },
    { name: 'jump.wav', type: 'audio', meta: '0:01' },
    { name: 'theme.ogg', type: 'audio', meta: '2:14' },
    { name: 'run.anim', type: 'animation' },
    { name: 'broken.png', type: 'texture', error: true },
  ],

  console: [
    { time: '12:00:40', lvl: 'cmd', text: 'world.spawn(Transform, Sprite, Velocity)', meta: '→ entity #1042' },
    { time: '12:01:41', lvl: 'info', text: 'RenderSystem scheduled after PhysicsSystem' },
    { time: '12:02:42', lvl: 'warn', text: 'Slime is missing a Collider component' },
    { time: '12:03:43', lvl: 'info', text: 'Hot-reloaded movement.ts in 38ms' },
    { time: '12:04:44', lvl: 'err', text: 'AudioSystem disabled — no output device' },
  ],
});

/** Count of components on an entity (for the hierarchy badge). */
export const componentCount = (scene: Scene, id: string): number => scene.components[id]?.length ?? 0;
