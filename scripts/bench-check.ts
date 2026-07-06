#!/usr/bin/env bun
// Regression gate for the benchmark suite. Runs each package's bench/index.ts
// in `--json` mode, normalizes the output, and diffs against the committed
// baseline.json. Exits non-zero if any bench is slower than baseline by more
// than the threshold.
//
// Usage:
//   bun run scripts/bench-check.ts             # diff against baseline
//   bun run scripts/bench-check.ts --update    # overwrite baselines with current numbers
//
// Threshold:
//   default 1.5 — set BENCH_REGRESSION_THRESHOLD=<n> to override.
//
// See docs/adr/ADR-0017 for methodology and rationale.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface NormalizedBench {
  readonly key: string;
  readonly group: string | null;
  readonly args: Readonly<Record<string, unknown>>;
  readonly mean_ns: number;
  readonly p99_ns: number;
  readonly samples: number;
}

interface NormalizedReport {
  readonly schema: 1;
  readonly package: string;
  readonly captured_at: string;
  readonly runtime: string;
  readonly benches: readonly NormalizedBench[];
}

interface BenchPackage {
  readonly name: string;
  readonly dir: string;
}

const PACKAGES: readonly BenchPackage[] = [
  { name: '@retro-engine/ecs', dir: 'packages/ecs' },
  { name: '@retro-engine/engine', dir: 'packages/engine' },
  { name: '@retro-engine/gltf', dir: 'packages/gltf' },
  { name: '@retro-engine/input', dir: 'packages/input' },
];

const REPO_ROOT = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const wantUpdate = argv.includes('--update');
const threshold = Number(process.env.BENCH_REGRESSION_THRESHOLD ?? '1.5');
if (!Number.isFinite(threshold) || threshold <= 1) {
  console.error(
    `bench-check: BENCH_REGRESSION_THRESHOLD must be a number > 1 (got ${process.env.BENCH_REGRESSION_THRESHOLD})`,
  );
  process.exit(2);
}

const captureReport = (pkg: BenchPackage): NormalizedReport => {
  const pkgDir = resolve(REPO_ROOT, pkg.dir);
  const result = spawnSync('bun', ['run', 'bench/index.ts', '--json'], {
    cwd: pkgDir,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`bench-check: bench run failed for ${pkg.name} (exit ${result.status})`);
  }
  const parsed = JSON.parse(result.stdout) as NormalizedReport;
  if (parsed.schema !== 1) {
    throw new Error(`bench-check: unexpected baseline schema version ${parsed.schema} from ${pkg.name}`);
  }
  return parsed;
};

const formatNs = (ns: number): string => {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`;
  return `${ns.toFixed(0)} ns`;
};

interface Row {
  readonly key: string;
  readonly baseline: number | null;
  readonly current: number;
  readonly ratio: number | null;
  readonly status: 'pass' | 'regress' | 'new';
}

const compareReports = (
  pkg: BenchPackage,
  baseline: NormalizedReport | null,
  current: NormalizedReport,
): readonly Row[] => {
  const baselineByKey = new Map(baseline?.benches.map((b) => [b.key, b]) ?? []);
  const rows: Row[] = [];
  for (const cur of current.benches) {
    const base = baselineByKey.get(cur.key);
    if (!base) {
      rows.push({ key: cur.key, baseline: null, current: cur.mean_ns, ratio: null, status: 'new' });
      continue;
    }
    const ratio = cur.mean_ns / base.mean_ns;
    rows.push({
      key: cur.key,
      baseline: base.mean_ns,
      current: cur.mean_ns,
      ratio,
      status: ratio > threshold ? 'regress' : 'pass',
    });
  }
  return rows;
};

const printRows = (pkgName: string, rows: readonly Row[]): void => {
  const widest = Math.max(...rows.map((r) => r.key.length), pkgName.length + 5);
  const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - s.length));
  console.log(`\n  ${pkgName}`);
  console.log(
    `  ${pad('bench', widest)}  ${pad('baseline', 12)}  ${pad('current', 12)}  ${pad('Δ', 10)}  status`,
  );
  console.log(`  ${'-'.repeat(widest)}  ${'-'.repeat(12)}  ${'-'.repeat(12)}  ${'-'.repeat(10)}  ------`);
  for (const r of rows) {
    const baseStr = r.baseline === null ? '—' : formatNs(r.baseline);
    const curStr = formatNs(r.current);
    const ratioStr = r.ratio === null ? '—' : `${r.ratio.toFixed(2)}×`;
    const status =
      r.status === 'pass' ? 'pass'
      : r.status === 'regress' ? 'REGRESS'
      : 'new';
    console.log(
      `  ${pad(r.key, widest)}  ${pad(baseStr, 12)}  ${pad(curStr, 12)}  ${pad(ratioStr, 10)}  ${status}`,
    );
  }
};

const main = (): number => {
  console.log(
    `bench-check: threshold ${threshold}× (override via BENCH_REGRESSION_THRESHOLD); mode=${wantUpdate ? 'update' : 'check'}`,
  );

  let anyRegress = false;
  let anyNew = false;

  for (const pkg of PACKAGES) {
    const baselinePath = resolve(REPO_ROOT, pkg.dir, 'bench/baseline.json');
    const baseline: NormalizedReport | null = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as NormalizedReport)
      : null;

    const current = captureReport(pkg);

    if (wantUpdate) {
      writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
      console.log(`  ${pkg.name}: wrote ${current.benches.length} bench entries to ${pkg.dir}/bench/baseline.json`);
      continue;
    }

    const rows = compareReports(pkg, baseline, current);
    printRows(pkg.name, rows);
    if (rows.some((r) => r.status === 'regress')) anyRegress = true;
    if (rows.some((r) => r.status === 'new')) anyNew = true;
  }

  if (wantUpdate) return 0;
  if (anyRegress) {
    console.log(`\nbench-check: at least one bench regressed beyond ${threshold}× — failing.`);
    return 1;
  }
  if (anyNew) {
    console.log(
      `\nbench-check: new benches detected without baseline entries — run \`bun run bench:update\` to capture them.`,
    );
    return 2;
  }
  console.log('\nbench-check: all benches within threshold.');
  return 0;
};

process.exit(main());
