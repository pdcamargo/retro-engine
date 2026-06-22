import { asRecord, reqNumber } from '../args';
import { type CommandDef, defineCommand } from '../registry';

/** Undo/redo: read the timeline and move through it. */
export const historyCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'history.list',
    title: 'History timeline',
    description: 'The full undo/redo timeline (oldest first) and the current cursor index.',
    domain: 'history',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ctx.history.view(),
  }),
  defineCommand({
    name: 'history.undo',
    title: 'Undo',
    description: 'Undo the most recent edit.',
    domain: 'history',
    mutating: true,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      ctx.history.undo();
      return { currentIndex: ctx.history.view().currentIndex };
    },
  }),
  defineCommand({
    name: 'history.redo',
    title: 'Redo',
    description: 'Redo the most recently undone edit.',
    domain: 'history',
    mutating: true,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      ctx.history.redo();
      return { currentIndex: ctx.history.view().currentIndex };
    },
  }),
  defineCommand({
    name: 'history.jumpTo',
    title: 'Jump in history',
    description: 'Move the world to the state at a timeline index (pass -1 to undo everything).',
    domain: 'history',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { index: { type: 'integer', description: 'target timeline index' } },
      required: ['index'],
    },
    handler: (ctx, args) => {
      ctx.history.jumpTo(reqNumber(asRecord(args), 'index'));
      return { currentIndex: ctx.history.view().currentIndex };
    },
  }),
];
