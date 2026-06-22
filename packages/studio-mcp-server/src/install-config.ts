import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { installSkills } from './install-skills';

/** The absolute path to this CLI entry, so the written config re-invokes it. */
const selfEntry = (): string => {
  const argv1 = process.argv[1];
  if (argv1 !== undefined && argv1.length > 0) return isAbsolute(argv1) ? argv1 : resolve(argv1);
  // Fallback: this module's own file (dist or src).
  return resolve(new URL(import.meta.url).pathname, '..', 'cli.ts');
};

/** The MCP server entry written into a client config — a local `bun` invocation (no npm publish required). */
export const localServerEntry = (): { command: string; args: string[] } => ({ command: 'bun', args: [selfEntry()] });

/**
 * Register the studio MCP server with Claude Code by merging it into a config
 * file (preserving everything else). Default target is the **user** config
 * (`~/.claude.json`) so it's available from every project; `--project` writes
 * `./.mcp.json` instead. User-scope installs also drop the global usage skill.
 * Returns the written config path.
 */
export const installClientConfig = async (args: readonly string[]): Promise<string> => {
  const project = args.includes('--project');
  const configPath = project ? join(process.cwd(), '.mcp.json') : join(homedir(), '.claude.json');

  let doc: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object') doc = parsed as Record<string, unknown>;
  } catch {
    // no existing config — start fresh
  }

  const existing = doc.mcpServers;
  const servers: Record<string, unknown> =
    existing !== null && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
  servers['retro-studio'] = localServerEntry();
  doc.mcpServers = servers;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.error(`[retro-studio-mcp] registered 'retro-studio' → ${configPath}`);

  // For user-scope installs, also make the usage skill available everywhere.
  if (!project) await installSkills(['--global']);

  return configPath;
};
