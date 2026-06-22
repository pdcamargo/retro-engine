import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The engine repo root, derived from this file's location (…/packages/studio-mcp-server/{src,dist}/). */
const engineRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const slug = (label: string): string => label.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'shot';

/** A tool result carrying a captured image. */
export interface ImageResult {
  readonly image: string;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
  readonly label?: string;
}

/** Whether a command result is an image (so the relay returns it as an MCP image + saves a copy). */
export const isImageResult = (value: unknown): value is ImageResult =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { image?: unknown }).image === 'string' &&
  typeof (value as { mimeType?: unknown }).mimeType === 'string';

/**
 * Write a captured image to `<engineRoot>/screenshots/<label>.png` (overwriting a
 * same-label shot) so the user can open it. Returns the absolute path.
 */
export const saveScreenshot = async (result: ImageResult, fallbackLabel: string): Promise<string> => {
  const ext = result.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const dir = join(engineRoot(), 'screenshots');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${slug(result.label ?? fallbackLabel)}.${ext}`);
  await writeFile(file, Buffer.from(result.image, 'base64'));
  console.error(`[retro-studio-mcp] saved screenshot → ${file}`);
  return file;
};
