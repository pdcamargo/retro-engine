import { asRecord, optNumber, optString, reqString } from '../args';
import type { CaptureResult, CaptureService } from '../context';
import { type CommandDef, defineCommand } from '../registry';

const requireCapture = (capture: CaptureService | undefined): CaptureService => {
  if (capture === undefined) throw new Error('mcp: screenshots are unavailable (no capture service in this context)');
  return capture;
};

/** Shape a capture result + a filename label for the relay to save and show inline. */
const present = (result: CaptureResult, label: string): CaptureResult & { label: string } => ({ ...result, label });

/** Screenshots: capture the whole editor or a single panel for visual inspection. */
export const screenshotCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'screenshot.editor',
    title: 'Screenshot editor',
    description:
      'Capture the entire studio window as a PNG (returned inline and saved to the engine .screenshots folder). Use to see custom UI and the rendered viewport.',
    domain: 'screenshot',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        maxWidth: { type: 'integer', description: 'downscale so width ≤ this (default 1280)' },
        label: { type: 'string', description: 'filename label for the saved PNG' },
      },
    },
    handler: async (ctx, args) => {
      const capture = requireCapture(ctx.capture);
      const record = asRecord(args);
      const result = await capture.editor(optNumber(record, 'maxWidth'));
      return present(result, optString(record, 'label') ?? 'editor');
    },
  }),
  defineCommand({
    name: 'screenshot.panel',
    title: 'Screenshot panel',
    description:
      "Capture a single editor panel by id (e.g. '/inspector', '/hierarchy', '/scene') as a PNG. See screenshot.panels for ids.",
    domain: 'screenshot',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        panel: { type: 'string', description: 'panel id, e.g. /inspector' },
        maxWidth: { type: 'integer', description: 'downscale so width ≤ this (default 1280)' },
        label: { type: 'string', description: 'filename label for the saved PNG' },
      },
      required: ['panel'],
    },
    handler: async (ctx, args) => {
      const capture = requireCapture(ctx.capture);
      const record = asRecord(args);
      const panel = reqString(record, 'panel');
      const result = await capture.panel(panel, optNumber(record, 'maxWidth'));
      if (result === null) {
        throw new Error(`mcp: panel '${panel}' has no captured rect — open it, or see screenshot.panels`);
      }
      return present(result, optString(record, 'label') ?? `panel${panel.replace(/[^a-z0-9]+/gi, '-')}`);
    },
  }),
  defineCommand({
    name: 'screenshot.panels',
    title: 'List capturable panels',
    description: 'Panel ids that can be screenshotted (those drawn at least once this session).',
    domain: 'screenshot',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({ panels: requireCapture(ctx.capture).panelIds() }),
  }),
];
