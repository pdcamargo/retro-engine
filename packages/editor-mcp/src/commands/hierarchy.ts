import type { Entity } from '@retro-engine/ecs';
import { type BuildOutlineOptions, buildOutline, type CustomCommand } from '@retro-engine/editor-sdk';

import { asRecord, reqEntity } from '../args';
import { type CommandDef, defineCommand } from '../registry';

/** Hierarchy: the scene tree and reparenting via the `Parent` edge. */
export const hierarchyCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'hierarchy.tree',
    title: 'Scene hierarchy',
    description:
      'The entity tree, flattened with depth, read from the Parent edge. Editor scaffolding is hidden unless debug mode is on.',
    domain: 'hierarchy',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      const opts: BuildOutlineOptions = {
        registry: ctx.state.debugMode ? undefined : ctx.registry,
        ...(ctx.classifiers !== undefined ? { classifiers: ctx.classifiers } : {}),
        ...(ctx.state.debugMode ? {} : { skip: (e: Entity): boolean => ctx.isEditorEntity(e) }),
      };
      return {
        nodes: buildOutline(ctx.world, opts).map((n) => ({
          entity: n.entity,
          name: n.name,
          depth: n.depth,
          kind: n.class.kind,
          hasChildren: n.hasChildren,
          components: n.componentCount,
        })),
      };
    },
  }),
  defineCommand({
    name: 'hierarchy.reparent',
    title: 'Reparent entity',
    description: 'Attach an entity under a new parent (or pass parent=null to make it a root). Undoable.',
    domain: 'hierarchy',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'integer', description: 'the entity to move' },
        parent: { type: 'integer', description: 'the new parent entity id, or null for a root' },
      },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const rawParent = record.parent;
      const newParent: Entity | null =
        rawParent === null || rawParent === undefined ? null : (reqEntity(record, 'parent') as Entity);
      if (newParent !== null && !ctx.world.hasEntity(newParent)) {
        throw new Error(`mcp: parent ${String(newParent)} does not exist`);
      }
      if (newParent !== null && newParent === entity) throw new Error('mcp: an entity cannot parent itself');

      const reg = ctx.registry.get('Parent');
      if (reg === undefined) throw new Error('mcp: the Parent component is not registered');
      const ParentCtor = reg.ctor;
      const setParent = (e: Entity, p: Entity | null): void => {
        if (p === null) {
          if (ctx.world.has(e, ParentCtor)) ctx.world.removeComponent(e, ParentCtor);
          return;
        }
        const existing = ctx.world.getComponent(e, ParentCtor) as { entity: Entity } | undefined;
        if (existing !== undefined) {
          existing.entity = p;
          ctx.world.markChanged(e, ParentCtor);
        } else {
          const inst = reg.make() as { entity: Entity };
          inst.entity = p;
          ctx.world.insertBundle(e, [inst]);
        }
      };
      const before = ctx.world.getComponent(entity, ParentCtor) as { entity: Entity } | undefined;
      const prevParent: Entity | null = before?.entity ?? null;

      const cmd: CustomCommand = {
        kind: 'custom',
        entity,
        componentName: '',
        label: newParent === null ? 'Unparent entity' : 'Reparent entity',
        apply: () => setParent(entity, newParent),
        revert: () => setParent(entity, prevParent),
      };
      ctx.history.apply(cmd);
      return { entity, parent: newParent };
    },
  }),
];
