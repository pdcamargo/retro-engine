import { describe, expect, it } from 'bun:test';

import { FrameTimeWindow, frameTimeStats } from './frame-time-window';

describe('frameTimeStats', () => {
  it('is all zeros for an empty window', () => {
    expect(frameTimeStats([])).toEqual({ min: 0, max: 0, avg: 0, p99: 0 });
  });

  it('computes min / max / avg', () => {
    const s = frameTimeStats([10, 20, 30]);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
    expect(s.avg).toBeCloseTo(20, 10);
  });

  it('sits p99 on the slow tail (nearest-rank)', () => {
    // 96 frames at 16ms + 4 slow frames at 100ms (100 total): the 99th-percentile
    // value falls within the slow tail → p99 = 100. (A single spike is p100/max,
    // not p99 — nearest-rank excludes the very slowest lone frame from p99.)
    const samples = [...Array.from({ length: 96 }, () => 16), 100, 100, 100, 100];
    const s = frameTimeStats(samples);
    expect(s.min).toBe(16);
    expect(s.max).toBe(100);
    expect(s.p99).toBe(100);
  });

  it('reports the max as p99 for a tiny window (rank clamped)', () => {
    const s = frameTimeStats([10, 20]);
    expect(s.p99).toBe(20); // ceil(2*0.99)-1 = 1 → sorted[1] = 20
  });

  it('does not mutate the input', () => {
    const samples = [30, 10, 20];
    frameTimeStats(samples);
    expect(samples).toEqual([30, 10, 20]);
  });
});

describe('FrameTimeWindow', () => {
  it('retains up to capacity, evicting the oldest', () => {
    const w = new FrameTimeWindow(3);
    w.push(1);
    w.push(2);
    w.push(3);
    expect(w.size).toBe(3);
    expect([...w.values()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    w.push(4); // evicts the oldest (1)
    expect(w.size).toBe(3);
    expect([...w.values()].sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it('reports stats over the current window', () => {
    const w = new FrameTimeWindow(4);
    for (const ms of [16, 16, 16, 50]) w.push(ms);
    const s = w.stats();
    expect(s.min).toBe(16);
    expect(s.max).toBe(50);
    expect(s.avg).toBeCloseTo((16 + 16 + 16 + 50) / 4, 10);
  });

  it('clears', () => {
    const w = new FrameTimeWindow(2);
    w.push(10);
    w.clear();
    expect(w.size).toBe(0);
    expect(w.stats()).toEqual({ min: 0, max: 0, avg: 0, p99: 0 });
  });
});
