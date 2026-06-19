import { isTauri } from '@retro-engine/editor-platform';

/**
 * Mirror the webview console to the native dev terminal under Tauri, so a native
 * session's frontend logs are visible alongside the Rust logs (the WKWebView has
 * no terminal of its own). No-op in a plain browser. Best-effort and fire-and-
 * forget — a failed forward never disturbs the original console call.
 */
export const mirrorConsoleToNative = (): void => {
  if (!isTauri()) return;
  const forward = (level: string, args: readonly unknown[]): void => {
    const message = `[${level}] ${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}`;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('studio_log', { message }))
      .catch(() => {});
  };
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...args);
      forward(level, args);
    };
  }
};
