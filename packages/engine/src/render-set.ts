/**
 * Named sub-sets inside the `'render'` stage.
 *
 * Each render-stage system belongs to exactly one set. The engine runs them
 * in the fixed order
 * `Extract → Prepare → Queue → PhaseSort → Render → Cleanup`. Within a set,
 * the usual `label` / `before` / `after` ordering primitives apply.
 *
 * - **Extract** — copy data from the main world into the render world.
 * - **Prepare** — build GPU resources from the extracted data (buffers,
 *   textures, bind groups).
 * - **Queue** — populate per-camera render jobs (phase items + draw fns).
 * - **PhaseSort** — sort phase items (by depth, pipeline, material, etc.).
 * - **Render** — execute the recorded commands inside the active render
 *   pass. The only set where {@link RenderCtx} resolves.
 * - **Cleanup** — release per-frame state. Runs after the pass has ended.
 *
 * Systems registered against `'render'` without an explicit set default to
 * {@link RenderSet.Render}, preserving the pre-ADR-0019 single-pass shape.
 */
export const RenderSet = {
  Extract: 'extract',
  Prepare: 'prepare',
  Queue: 'queue',
  PhaseSort: 'phaseSort',
  Render: 'render',
  Cleanup: 'cleanup',
} as const;

/** One of the {@link RenderSet} values. */
export type RenderSetName = (typeof RenderSet)[keyof typeof RenderSet];

/**
 * Canonical execution order. Iteration follows this list inside
 * `App.renderFrame()`. The render pass opens between {@link RenderSet.PhaseSort}
 * and {@link RenderSet.Render}, and closes between {@link RenderSet.Render}
 * and {@link RenderSet.Cleanup}.
 */
export const RENDER_SET_ORDER: readonly RenderSetName[] = [
  RenderSet.Extract,
  RenderSet.Prepare,
  RenderSet.Queue,
  RenderSet.PhaseSort,
  RenderSet.Render,
  RenderSet.Cleanup,
];
