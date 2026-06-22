import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { RETRO_STUDIO_SKILL_MD } from '@retro-engine/mcp-protocol';

import type { StudioLink } from './relay';
import { isImageResult, saveScreenshot } from './screenshots';

interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: 'object'; readonly properties?: Record<string, unknown>; readonly required?: readonly string[] };
}

/** Tools the relay always offers, independent of the studio connection. */
const STATIC_TOOLS: readonly ToolDef[] = [
  {
    name: 'studio.connected',
    description: 'Whether the studio is connected to this MCP relay, with how many commands it offers.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'batch',
    description:
      'Run several studio commands in one call. steps: [{ command, args? }] run in order; every result is returned. Use to spawn-and-configure in a single round trip.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { command: { type: 'string' }, args: { type: 'object' } },
            required: ['command'],
          },
        },
      },
      required: ['steps'],
    },
  },
];

const asText = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

/**
 * Build the stdio MCP server. Tools are sourced live from the studio's catalog
 * (plus the static `studio.connected` / `batch`), so adding a command in the
 * studio surfaces a new tool with no relay change. Tool calls are forwarded to
 * the studio over the {@link StudioLink}.
 */
export const createMcpServer = (link: StudioLink, info: { url: string; version: string }): Server => {
  const server = new Server(
    { name: 'retro-studio', version: info.version },
    { capabilities: { tools: { listChanged: true }, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...STATIC_TOOLS,
      ...link.commands.map((c) => ({
        name: c.name,
        description: c.description,
        inputSchema: c.inputSchema as ToolDef['inputSchema'],
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};
    try {
      if (name === 'studio.connected') {
        return asText({ connected: link.connected, url: info.url, commands: link.commands.length });
      }
      if (name === 'batch') {
        return asText(await link.invoke('$batch', args));
      }
      const result = await link.invoke(name, args);
      if (isImageResult(result)) {
        const saved = await saveScreenshot(result, name);
        return {
          content: [
            { type: 'image' as const, data: result.image, mimeType: result.mimeType },
            { type: 'text' as const, text: `Saved ${result.width}×${result.height} screenshot → ${saved}` },
          ],
        };
      }
      return asText(result);
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{ name: 'retro-studio-cheatsheet', description: 'How to drive the Retro Engine studio over MCP.' }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: RETRO_STUDIO_SKILL_MD } }],
  }));

  return server;
};
