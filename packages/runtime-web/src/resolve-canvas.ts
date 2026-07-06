/**
 * A canvas selector: an `HTMLCanvasElement` to render into directly, or the
 * element `id` of one already in the document.
 */
export type CanvasTarget = HTMLCanvasElement | string;

/** The minimal `document` surface {@link resolveCanvas} needs, for testability. */
export interface CanvasDocument {
  getElementById(id: string): { tagName?: string } | null;
}

const isCanvas = (value: unknown): value is HTMLCanvasElement =>
  typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement;

/**
 * Resolve a {@link CanvasTarget} to a concrete `HTMLCanvasElement`.
 *
 * A canvas element is returned as-is. A string is looked up by `id` in `doc`
 * (defaults to the ambient `document`); the lookup must resolve to a `<canvas>`.
 * Throws a descriptive error when the id is missing or resolves to a non-canvas
 * element — a misconfigured host page should fail loudly, not silently render
 * nowhere.
 */
export const resolveCanvas = (
  target: CanvasTarget,
  doc?: CanvasDocument,
): HTMLCanvasElement => {
  if (isCanvas(target)) return target;

  const source = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (source === undefined) {
    throw new Error(
      `bootWebGame: no document available to resolve canvas id '${target}'. Pass an HTMLCanvasElement instead.`,
    );
  }

  const element = source.getElementById(target);
  if (element === null) {
    throw new Error(`bootWebGame: no element with id '${target}' found in the document.`);
  }
  const tag = element.tagName?.toUpperCase();
  if (tag !== 'CANVAS') {
    throw new Error(
      `bootWebGame: element '#${target}' is a <${tag?.toLowerCase() ?? 'unknown'}>, not a <canvas>.`,
    );
  }
  return element as HTMLCanvasElement;
};
