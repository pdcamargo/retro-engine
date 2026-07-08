/**
 * Decimal places for a drag/number field: a step-derived base (0 for integer
 * steps, 1 normally, 2 for sub-0.01 steps), widened for a small non-zero
 * magnitude so it never renders as `0`. A cm→m scale of `0.01` at one decimal
 * would show `"0.0"` and read as zero (a real debugging trap); this shows enough
 * significant digits — first significant place + 1 — capped at 6 so large values
 * stay compact. Zero and magnitudes ≥ 1 keep the base precision.
 */
export const adaptiveDecimals = (value: number, step: number | undefined): number => {
  const base = step !== undefined && step < 1 ? (step <= 0.01 ? 2 : 1) : 0;
  const mag = Math.abs(value);
  if (!Number.isFinite(mag) || mag === 0 || mag >= 1) return base;
  const needed = Math.ceil(-Math.log10(mag)) + 1;
  return Math.min(6, Math.max(base, needed));
};
