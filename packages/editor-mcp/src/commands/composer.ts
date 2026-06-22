import { asRecord, optNumber, optString } from '../args';
import type { ComposerControl } from '../context';
import { type CommandDef, defineCommand } from '../registry';

const requireComposer = (composer: ComposerControl | undefined): ComposerControl => {
  if (composer === undefined) throw new Error('mcp: the Entity Composer is unavailable in this context');
  return composer;
};

/** Entity Composer: open the create/add/bundle modal, close it, read its state. */
export const composerCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'composer.open',
    title: 'Open composer',
    description:
      "Open the Entity Composer modal. mode 'create' (a new entity), 'add' (components onto target, defaults to the selection), or 'bundle' (author a bundle).",
    domain: 'composer',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['create', 'add', 'bundle'], description: 'composer mode (default create)' },
        target: { type: 'integer', description: "entity to target in 'add' mode (defaults to the selection)" },
      },
    },
    handler: (ctx, args) => {
      const composer = requireComposer(ctx.composer);
      const record = asRecord(args);
      const mode = (optString(record, 'mode') ?? 'create') as 'create' | 'add' | 'bundle';
      composer.open(mode, optNumber(record, 'target'));
      return { open: true, mode };
    },
  }),
  defineCommand({
    name: 'composer.close',
    title: 'Close composer',
    description: 'Close the Entity Composer modal.',
    domain: 'composer',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      requireComposer(ctx.composer).close();
      return { open: false };
    },
  }),
  defineCommand({
    name: 'composer.state',
    title: 'Composer state',
    description: 'Whether the composer is open and in which mode.',
    domain: 'composer',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      const composer = requireComposer(ctx.composer);
      return { open: composer.isOpen(), mode: composer.mode() };
    },
  }),
];
