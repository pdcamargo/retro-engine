// Bench runner entry for @retro-engine/build. Pretty-prints mitata's default
// summary unless `--json` is passed, in which case the normalized snapshot
// (see docs/adr/ADR-0017 for schema) is written to stdout.
//
// Usage:
//   bun run bench/index.ts             # human-readable summary
//   bun run bench/index.ts --json      # normalized JSON snapshot
//   bun run bench/index.ts --filter p  # mitata filter regex applied to bench names

import { run } from 'mitata';

import './rpak.bench';

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

const argv = process.argv.slice(2);
const wantJson = argv.includes('--json');
const filterArg = (() => {
  const i = argv.indexOf('--filter');
  if (i < 0 || i === argv.length - 1) return undefined;
  return new RegExp(argv[i + 1]!);
})();

const runtimeId = typeof Bun !== 'undefined' ? `bun@${Bun.version}` : `node@${process.version}`;

const runOpts = wantJson
  ? ({ format: 'quiet' as const, colors: false, ...(filterArg && { filter: filterArg }) })
  : ({ colors: true, ...(filterArg && { filter: filterArg }) });

const result = await run(runOpts);

if (wantJson) {
  const benches: NormalizedBench[] = [];
  for (const trial of result.benchmarks) {
    for (const r of trial.runs) {
      if (!r.stats) continue;
      const argsEntries = Object.entries(r.args ?? {}).sort(([a], [b]) => a.localeCompare(b));
      const argsKey = argsEntries.length
        ? `[${argsEntries.map(([k, v]) => `${k}=${String(v)}`).join(',')}]`
        : '';
      benches.push({
        key: `${trial.alias}${argsKey}`,
        group: null,
        args: Object.fromEntries(argsEntries),
        mean_ns: r.stats.avg,
        p99_ns: r.stats.p99,
        samples: r.stats.samples.length,
      });
    }
  }
  const report: NormalizedReport = {
    schema: 1,
    package: '@retro-engine/build',
    captured_at: new Date().toISOString(),
    runtime: runtimeId,
    benches,
  };
  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write('\n');
}
