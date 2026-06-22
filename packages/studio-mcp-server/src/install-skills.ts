import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { RETRO_STUDIO_SKILL_MD, RETRO_STUDIO_SKILL_NAME } from '@retro-engine/mcp-protocol';

/**
 * Write the Retro Engine studio skill into a Claude Code skills directory:
 * `--global` targets `~/.claude/skills`, otherwise the current project's
 * `.claude/skills`. Returns the written path.
 */
export const installSkills = async (args: readonly string[]): Promise<string> => {
  const global = args.includes('--global');
  const base = global ? join(homedir(), '.claude', 'skills') : join(process.cwd(), '.claude', 'skills');
  const dir = join(base, RETRO_STUDIO_SKILL_NAME);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  await writeFile(file, RETRO_STUDIO_SKILL_MD, 'utf8');
  console.error(`[retro-studio-mcp] installed skill → ${file}`);
  return file;
};
