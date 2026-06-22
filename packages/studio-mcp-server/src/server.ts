import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { STUDIO_MCP_DEFAULT_PORT } from '@retro-engine/mcp-protocol';

import { createMcpServer } from './mcp';
import { StudioLink } from './relay';

/** Relay version reported in the MCP handshake. */
export const RELAY_VERSION = '0.0.0';

/**
 * Start the relay: bind the localhost WebSocket bridge the studio connects to,
 * then serve MCP over stdio, forwarding tool calls to the studio. Logs go to
 * stderr only — stdout is the MCP transport.
 */
export const runServer = async (): Promise<void> => {
  const port = Number(process.env.RETRO_STUDIO_MCP_PORT ?? STUDIO_MCP_DEFAULT_PORT);
  const url = `ws://127.0.0.1:${port}`;
  const link = new StudioLink();
  try {
    await link.listen(port);
  } catch (err) {
    console.error(`[retro-studio-mcp] failed to bind ${url}: ${err instanceof Error ? err.message : String(err)}`);
    console.error('[retro-studio-mcp] is another studio MCP relay already running? Set RETRO_STUDIO_MCP_PORT to use another port.');
    process.exitCode = 1;
    return;
  }
  console.error(`[retro-studio-mcp] bridge listening on ${url}`);

  const server = createMcpServer(link, { url, version: RELAY_VERSION });

  // Only advertise catalog changes once the MCP session is initialized — sending a
  // notification before the `initialize` handshake completes corrupts the stream
  // and the client marks the server failed. The initial tools/list (always issued
  // after init) reflects the current catalog, so nothing is missed before this.
  let initialized = false;
  server.oninitialized = (): void => {
    initialized = true;
  };
  link.onCatalogChange(() => {
    if (!initialized) return;
    void server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {
      // client went away mid-send; the reconnect/relaunch handles it
    });
  });

  // The WebSocket bridge keeps the event loop alive, so the process would outlive
  // the AI client unless we exit when the stdio transport closes (client gone).
  // A lingering relay holds the port and blocks the next session's relay.
  const shutdown = (): void => {
    link.close();
    process.exit(0);
  };
  server.onclose = shutdown;
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  console.error('[retro-studio-mcp] MCP server ready on stdio');
};
