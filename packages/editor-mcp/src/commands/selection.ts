import type { Entity } from '@retro-engine/ecs';

import { asRecord, optNumber, reqEntity } from '../args';
import { type CommandDef, defineCommand } from '../registry';
import { encodeEntityComponents } from '../reflect-json';

/** Selection: read, set, clear, and inspect the entity the inspector is showing. */
export const selectionCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'selection.get',
    title: 'Get selection',
    description: 'The currently selected entity id (the one shown in the inspector), or null.',
    domain: 'selection',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({ entity: ctx.state.selectedEntity }),
  }),
  defineCommand({
    name: 'selection.set',
    title: 'Set selection',
    description: 'Select an entity by id, driving the hierarchy highlight and the inspector.',
    domain: 'selection',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer', description: 'entity id to select' } },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const entity = reqEntity(asRecord(args));
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      ctx.state.selectedEntity = entity;
      return { entity };
    },
  }),
  defineCommand({
    name: 'selection.clear',
    title: 'Clear selection',
    description: 'Deselect — the inspector shows nothing.',
    domain: 'selection',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      ctx.state.selectedEntity = null;
      return { entity: null };
    },
  }),
  defineCommand({
    name: 'selection.inspected',
    title: 'Inspect selection',
    description:
      'The selected entity (or a given entity) with every component and its serialized field values — what the inspector shows.',
    domain: 'selection',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer', description: 'entity id to inspect (defaults to the selection)' } },
    },
    handler: (ctx, args) => {
      const override = optNumber(asRecord(args), 'entity');
      const target: Entity | null = override !== undefined ? (override as unknown as Entity) : ctx.state.selectedEntity;
      if (target === null) return { entity: null, components: [] };
      if (!ctx.world.hasEntity(target)) throw new Error(`mcp: entity ${String(target)} does not exist`);
      return { entity: target, components: encodeEntityComponents(ctx, target) };
    },
  }),
];
