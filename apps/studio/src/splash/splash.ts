// Controller for the project-loading splash. The markup + styles live in
// index.html (so the splash paints on the first frame, before this module even
// runs); this drives its boot-log, progress bar, spinner, and dismissal from the
// real load milestones. Mirrors handoff/editor-splash (EditorSplash.md).
//
// Real load milestones arrive in bursts (two early, the rest at once just before
// the first frame), so revealing them immediately would flash the whole log and
// dismiss before it can be read. Lines are instead queued and revealed on a steady
// cadence; dismissal waits for the queue to drain plus a readable hold.

/** A boot-log line's semantic tone — picks its glyph + result colors. */
export type SplashTone = 'accent' | 'info' | 'warning' | 'ready';

/** One streamed boot-log line: `<glyph> <message> <target?> … <result>`. */
export interface SplashLine {
  /** Status glyph: `▸` step, `!` warning, `●` ready. */
  readonly glyph: string;
  readonly message: string;
  /** Optional bright target (e.g. the scene file). */
  readonly target?: string;
  /** Right-aligned result (`ok`, `248 entities`, `62 ms`, …). */
  readonly result: string;
  readonly tone: SplashTone;
}

/** The splash surface — a no-op shell when the splash element is absent. */
export interface Splash {
  /** Queue a boot-log line that advances the step counter + progress bar. */
  step(line: SplashLine): void;
  /** Queue a non-advancing line (e.g. an amber warning) without bumping progress. */
  note(line: SplashLine): void;
  /** Set the ellipsis-truncated project/scene name on the status line. */
  setProject(name: string): void;
  /** Set the pixel eyebrow (e.g. `EDITOR · v0.5.0`). */
  setEyebrow(text: string): void;
  /** Set the bottom footer line. */
  setFooter(text: string): void;
  /** Queue the terminal ready line — flips the spinner to `●` once it is revealed. */
  ready(line: SplashLine): void;
  /** Request dismissal: fades out once the queued lines have all been shown. */
  dismiss(): void;
}

const TONE: Readonly<Record<SplashTone, { glyph: string; result: string }>> = {
  accent: { glyph: 'var(--accent-bright)', result: 'var(--accent-bright)' },
  info: { glyph: 'var(--info)', result: 'var(--info)' },
  warning: { glyph: 'var(--warning)', result: 'var(--warning)' },
  ready: { glyph: 'var(--accent)', result: 'var(--accent-bright)' },
};

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/** Minimum gap between revealed boot-log lines (ms) — readable, mechanical pacing. */
const REVEAL_MS = 300;
/** How long the finished "ready" state is held before the splash fades out (ms). */
const READY_HOLD_MS = 650;

const noop: Splash = {
  step: () => {},
  note: () => {},
  setProject: () => {},
  setEyebrow: () => {},
  setFooter: () => {},
  ready: () => {},
  dismiss: () => {},
};

const byId = (id: string): HTMLElement | null => document.getElementById(id);

const appendLine = (log: HTMLElement, line: SplashLine): void => {
  const tone = TONE[line.tone];
  const row = document.createElement('div');
  row.className = 'logline';
  const glyph = document.createElement('span');
  glyph.className = 'lglyph';
  glyph.style.color = tone.glyph;
  glyph.textContent = line.glyph;
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = line.message;
  row.append(glyph, msg);
  if (line.target !== undefined) {
    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = line.target;
    row.append(target);
  }
  const dots = document.createElement('span');
  dots.className = 'dots';
  const res = document.createElement('span');
  res.className = 'res';
  res.style.color = tone.result;
  res.textContent = line.result;
  row.append(dots, res);
  // Keep the blinking caret pinned to the bottom of the bottom-anchored log.
  const caret = log.querySelector('.cursor');
  if (caret !== null) log.insertBefore(row, caret);
  else log.append(row);
};

/** One queued reveal: the line, whether it advances progress, and if it's terminal. */
interface Queued {
  readonly line: SplashLine;
  readonly advance: boolean;
  readonly final: boolean;
}

/**
 * Attach to the splash element rendered in index.html. Returns a no-op surface
 * if it is absent (e.g. a headless/test page), so callers never branch.
 *
 * @param total - The number of `step` milestones planned, for the `n / total`
 *   counter and the progress bar.
 */
export const createSplash = (total: number): Splash => {
  const root = byId('studio-splash');
  if (root === null) return noop;

  const log = byId('splash-log');
  const fill = byId('splash-fill');
  const pct = byId('splash-pct');
  const count = byId('splash-count');
  const spin = byId('splash-spin');
  const phase = byId('splash-phase');
  const project = byId('splash-project');
  const eyebrow = byId('splash-eyebrow');
  const footer = byId('splash-footer');

  const queue: Queued[] = [];
  let current = 0;
  let dismissRequested = false;
  let dismissed = false;

  const setCount = (): void => {
    if (count !== null) count.textContent = `${current} / ${total}`;
  };
  const setProgress = (value: number): void => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    if (fill !== null) fill.style.width = `${clamped}%`;
    if (pct !== null) pct.textContent = `${clamped}%`;
  };
  setCount();

  // Braille spinner — advances until the terminal line is revealed.
  let frame = 0;
  const spinner = setInterval(() => {
    if (spin !== null) spin.textContent = SPIN[frame % SPIN.length]!;
    frame++;
  }, 90);

  const finish = (): void => {
    if (dismissed) return;
    dismissed = true;
    clearInterval(spinner);
    clearInterval(reveal);
    root.classList.add('is-hiding');
    setTimeout(() => root.remove(), 160);
  };

  // Reveal one queued line per tick; ease progress toward each step's target. When
  // the queue is empty and dismissal was requested, hold the ready state, then fade.
  const reveal = setInterval(() => {
    const next = queue.shift();
    if (next === undefined) {
      if (dismissRequested) {
        clearInterval(reveal);
        setTimeout(finish, READY_HOLD_MS);
      }
      return;
    }
    if (log !== null) appendLine(log, next.line);
    if (next.advance) {
      current = Math.min(total, current + 1);
      setCount();
      setProgress((current / total) * 100);
    }
    if (next.final) {
      current = total;
      setCount();
      setProgress(100);
      clearInterval(spinner);
      if (spin !== null) spin.textContent = '●';
      if (phase !== null) phase.textContent = 'ready —';
    }
  }, REVEAL_MS);

  return {
    step(line: SplashLine): void {
      queue.push({ line, advance: true, final: false });
    },
    note(line: SplashLine): void {
      queue.push({ line, advance: false, final: false });
    },
    setProject(name: string): void {
      if (project !== null) project.textContent = name;
    },
    setEyebrow(text: string): void {
      if (eyebrow !== null) eyebrow.textContent = text;
    },
    setFooter(text: string): void {
      if (footer !== null) footer.textContent = text;
    },
    ready(line: SplashLine): void {
      queue.push({ line, advance: false, final: true });
    },
    dismiss(): void {
      dismissRequested = true;
    },
  };
};
