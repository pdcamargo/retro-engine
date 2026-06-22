import { asRecord, reqString } from '../args';
import { type CommandDef, defineCommand } from '../registry';

/** Panels: list, show/hide, and focus (select a docked tab). */
export const panelCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'panel.list',
    title: 'List panels',
    description: 'Every editor panel with its id, title, and whether it is currently shown.',
    domain: 'panel',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({ panels: ctx.editor.listPanels() }),
  }),
  defineCommand({
    name: 'panel.open',
    title: 'Open panel',
    description: 'Show a panel by id (e.g. /inspector).',
    domain: 'panel',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { panel: { type: 'string', description: 'panel id' } },
      required: ['panel'],
    },
    handler: (ctx, args) => {
      const id = reqString(asRecord(args), 'panel');
      ctx.editor.setPanelOpen(id, true);
      return { panel: id, open: true };
    },
  }),
  defineCommand({
    name: 'panel.close',
    title: 'Close panel',
    description: 'Hide a panel by id.',
    domain: 'panel',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { panel: { type: 'string', description: 'panel id' } },
      required: ['panel'],
    },
    handler: (ctx, args) => {
      const id = reqString(asRecord(args), 'panel');
      ctx.editor.setPanelOpen(id, false);
      return { panel: id, open: false };
    },
  }),
  defineCommand({
    name: 'panel.focus',
    title: 'Focus panel',
    description: 'Bring a panel to the front — selects its tab when docked with others.',
    domain: 'panel',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { panel: { type: 'string', description: 'panel id' } },
      required: ['panel'],
    },
    handler: (ctx, args) => {
      const id = reqString(asRecord(args), 'panel');
      ctx.editor.focusPanel(id);
      return { panel: id, focused: true };
    },
  }),
];
