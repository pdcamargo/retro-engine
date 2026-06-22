import { asRecord, optNumber } from '../args';
import { type CommandDef, defineCommand } from '../registry';

/** Logs: recent engine/editor log lines. */
export const logCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'logs.recent',
    title: 'Recent logs',
    description: 'The most recent engine/editor log lines (newest last).',
    domain: 'logs',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'max lines to return (default 50)' } },
    },
    handler: (ctx, args) => {
      const limit = optNumber(asRecord(args), 'limit');
      return { lines: ctx.logs.recent(limit) };
    },
  }),
];
