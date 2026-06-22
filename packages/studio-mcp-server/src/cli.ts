#!/usr/bin/env node
import { installClientConfig } from './install-config';
import { installSkills } from './install-skills';
import { runServer } from './server';

const HELP = `retro-studio-mcp — MCP relay for the Retro Engine studio

Usage:
  retro-studio-mcp                 Start the MCP relay (stdio). Launched by your AI client.
  retro-studio-mcp install         Register the server in ~/.claude.json (user scope — every project)
                                   and install the usage skill globally.
  retro-studio-mcp install --project   Register it in ./.mcp.json instead (current project only).
  retro-studio-mcp install-skills [--global]   Install just the usage skill.

Env:
  RETRO_STUDIO_MCP_PORT            WebSocket bridge port (default 8787; must match the studio's MCP panel).
`;

const main = async (): Promise<void> => {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'install') {
    await installClientConfig(rest);
    return;
  }
  if (cmd === 'install-skills') {
    await installSkills(rest);
    return;
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stderr.write(HELP);
    return;
  }
  await runServer();
};

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
