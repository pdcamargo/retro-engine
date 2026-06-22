import { serializeScene } from '@retro-engine/engine';

import { type CommandDef, defineCommand } from '../registry';

/** Scene: read the serialized world, save it, and check the dirty flag. */
export const sceneCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'scene.get',
    title: 'Get scene',
    description: 'The current scene as serialized data (authored entities only — editor scaffolding excluded).',
    domain: 'scene',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => serializeScene(ctx.app, { filter: (e) => !ctx.isEditorEntity(e) }),
  }),
  defineCommand({
    name: 'scene.save',
    title: 'Save scene',
    description: 'Persist the current scene to the open project. Fails if no project is open.',
    domain: 'scene',
    mutating: true,
    inputSchema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      if (ctx.saveScene === undefined) throw new Error('mcp: no project open to save into');
      const result = await ctx.saveScene();
      if ('error' in result) throw new Error(result.error);
      return result;
    },
  }),
  defineCommand({
    name: 'scene.dirty',
    title: 'Scene dirty state',
    description: 'Whether the scene has unsaved edits.',
    domain: 'scene',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({ dirty: ctx.state.dirty }),
  }),
];
