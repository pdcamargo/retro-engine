import type { JitterOffset } from '../camera/jitter';

/**
 * Length of the jitter sample loop. The camera cycles through this many
 * Halton offsets before repeating; a power of two keeps the pattern from
 * drifting against any frame-count modulus downstream. Eight is enough to read
 * as smooth at typical frame rates without stretching the history reach too far.
 */
export const TAA_JITTER_SAMPLE_COUNT = 8;

/**
 * The radical-inverse Halton low-discrepancy sequence for a given base. Index
 * is 1-based (index 0 returns 0, which is the lattice center and a poor jitter
 * sample — callers offset by one).
 */
const halton = (index: number, base: number): number => {
  let result = 0;
  let fraction = 1;
  let i = index;
  while (i > 0) {
    fraction /= base;
    result += fraction * (i % base);
    i = Math.floor(i / base);
  }
  return result;
};

/**
 * Sub-pixel jitter offset for the given frame index, in framebuffer pixels
 * within `[-0.5, 0.5]`. Uses the Halton(2, 3) sequence — the canonical TAA
 * jitter pattern — cycled over {@link TAA_JITTER_SAMPLE_COUNT} frames.
 */
export const haltonJitter = (frameIndex: number): JitterOffset => {
  // 1-based index into the sequence, wrapped to the sample window.
  const i = (((frameIndex % TAA_JITTER_SAMPLE_COUNT) + TAA_JITTER_SAMPLE_COUNT) %
    TAA_JITTER_SAMPLE_COUNT) +
    1;
  return { x: halton(i, 2) - 0.5, y: halton(i, 3) - 0.5 };
};
