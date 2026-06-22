import { requestSimState, SimState } from '@retro-engine/editor-sdk';

import { asRecord, optNumber, reqString } from '../args';
import { type CommandDef, defineCommand } from '../registry';

/** Best-effort conversion of an arbitrary value to something JSON-serializable. */
const toJsonSafe = (value: unknown): unknown => {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

/** Studio control: state snapshot, play/pause/stop, audit log, ping, and eval. */
export const studioCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'studio.ping',
    title: 'Ping',
    description: 'Confirm the studio bridge is responsive.',
    domain: 'studio',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({ ok: true }),
  }),
  defineCommand({
    name: 'studio.state',
    title: 'Studio state',
    description: 'Selection, play/pause mode, view mode, and dirty flag.',
    domain: 'studio',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({
      selected: ctx.state.selectedEntity,
      playing: ctx.state.playing,
      paused: ctx.state.paused,
      viewMode: ctx.state.viewMode,
      dirty: ctx.state.dirty,
    }),
  }),
  defineCommand({
    name: 'studio.play',
    title: 'Enter play mode',
    description: 'Start play mode (gameplay systems run).',
    domain: 'studio',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      requestSimState(ctx.app, SimState.Play);
      return { simState: 'Play' };
    },
  }),
  defineCommand({
    name: 'studio.pause',
    title: 'Pause play mode',
    description: 'Pause play mode.',
    domain: 'studio',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      requestSimState(ctx.app, SimState.Paused);
      return { simState: 'Paused' };
    },
  }),
  defineCommand({
    name: 'studio.stop',
    title: 'Stop play mode',
    description: 'Return to edit mode.',
    domain: 'studio',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      requestSimState(ctx.app, SimState.Edit);
      return { simState: 'Edit' };
    },
  }),
  defineCommand({
    name: 'studio.audit',
    title: 'Audit log',
    description: 'Recent mutating MCP commands (what the AI has changed), newest last.',
    domain: 'studio',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'max entries (default 50)' } },
    },
    handler: (ctx, args) => ({ entries: ctx.audit.recent(optNumber(asRecord(args), 'limit')) }),
  }),
  defineCommand({
    name: 'studio.eval',
    title: 'Evaluate code',
    description:
      'Run TypeScript/JavaScript against the live studio. Your code receives (app, world, state, editor); a returned value (or a bare expression) is sent back JSON-safe. Only available when the user has enabled "Allow eval".',
    domain: 'studio',
    mutating: true,
    available: (ctx) => ctx.allowEval(),
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'code to run; may return a value' } },
      required: ['code'],
    },
    handler: async (ctx, args) => {
      const code = reqString(asRecord(args), 'code');
      const make = (src: string): ((...a: unknown[]) => unknown) =>
        new Function('app', 'world', 'state', 'editor', src) as (...a: unknown[]) => unknown;
      let fn: (...a: unknown[]) => unknown;
      try {
        fn = make(`return (${code});`);
      } catch {
        fn = make(code);
      }
      const raw = await fn(ctx.app, ctx.world, ctx.state, ctx.editor);
      return { result: toJsonSafe(raw) };
    },
  }),
];
