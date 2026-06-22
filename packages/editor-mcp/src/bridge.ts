import {
  BATCH_COMMAND,
  type BatchStep,
  type BatchStepResult,
  type InvokeFrame,
  MCP_PROTOCOL_VERSION,
  STUDIO_MCP_DEFAULT_PORT,
  type StudioInfo,
  type StudioToServerFrame,
} from '@retro-engine/mcp-protocol';

import { asRecord } from './args';
import type { CommandContext } from './context';
import type { CommandRegistry } from './registry';

/** Live connection state, surfaced to the studio's MCP panel. */
export interface BridgeStatus {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly url: string;
  readonly lastError: string | null;
}

/** Options for {@link createStudioBridge}. */
export interface StudioBridgeOptions {
  /** Port the relay listens on. Ignored when {@link url} is set. */
  readonly port?: number;
  /** Full WebSocket URL override (defaults to `ws://127.0.0.1:<port>`). */
  readonly url?: string;
  /** Studio identity sent in the hello frame. */
  readonly studio: StudioInfo;
  /** Notified whenever connection state changes (for a status indicator). */
  readonly onStatusChange?: (status: BridgeStatus) => void;
}

const RECONNECT_MS = 1000;

const timestamp = (): string => new Date().toLocaleTimeString('en-US', { hour12: false });

type RunOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly message: string; readonly stack?: string } };

/**
 * The studio side of the MCP link: a reconnecting WebSocket client that, when a
 * relay is up, advertises the command catalog and serves invoke requests against
 * the live {@link CommandContext}. Owns nothing the studio can't restart — call
 * {@link start}/{@link stop} from the MCP panel toggle.
 */
export class StudioBridge {
  private ws: WebSocket | null = null;
  private enabled = false;
  private connected = false;
  private lastError: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly url: string;

  constructor(
    private readonly registry: CommandRegistry,
    private readonly ctx: CommandContext,
    private readonly opts: StudioBridgeOptions,
  ) {
    this.url = opts.url ?? `ws://127.0.0.1:${opts.port ?? STUDIO_MCP_DEFAULT_PORT}`;
  }

  /** Begin connecting (and auto-reconnecting). Idempotent. */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.connect();
    this.emit();
  }

  /** Disconnect and stop reconnecting. Idempotent. */
  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws !== null) {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    this.emit();
  }

  status(): BridgeStatus {
    return { enabled: this.enabled, connected: this.connected, url: this.url, lastError: this.lastError };
  }

  /** Re-advertise the catalog if connected (call when command availability changes, e.g. eval toggled). */
  refreshCatalog(): void {
    if (!this.connected) return;
    this.send({ type: 'catalog', commands: this.registry.manifest(this.ctx) });
  }

  private connect(): void {
    if (!this.enabled) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = (): void => {
      this.connected = true;
      this.lastError = null;
      this.send({
        type: 'hello',
        protocolVersion: MCP_PROTOCOL_VERSION,
        studio: this.opts.studio,
        commands: this.registry.manifest(this.ctx),
      });
      this.emit();
    };
    ws.onmessage = (ev: MessageEvent): void => {
      void this.onMessage(ev.data);
    };
    ws.onerror = (): void => {
      // A failed connect while no relay is running is the normal "waiting" state,
      // not an error worth surfacing — the reconnect loop (onclose) handles it.
    };
    ws.onclose = (): void => {
      this.connected = false;
      this.ws = null;
      this.emit();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);
  }

  private send(frame: StudioToServerFrame): void {
    try {
      this.ws?.send(JSON.stringify(frame));
    } catch {
      /* socket closing mid-send */
    }
  }

  private emit(): void {
    this.opts.onStatusChange?.(this.status());
  }

  private async onMessage(data: unknown): Promise<void> {
    let frame: InvokeFrame;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data)) as InvokeFrame;
    } catch {
      return;
    }
    if (frame.type !== 'invoke') return;
    const outcome = await this.dispatch(frame.name, frame.args);
    if (outcome.ok) this.send({ type: 'result', id: frame.id, ok: true, result: outcome.value });
    else this.send({ type: 'result', id: frame.id, ok: false, error: outcome.error });
  }

  private async dispatch(name: string, args: unknown): Promise<RunOutcome> {
    if (name === BATCH_COMMAND) {
      const steps = (asRecord(args).steps ?? []) as readonly BatchStep[];
      const results: BatchStepResult[] = [];
      for (const step of steps) {
        const r = await this.runOne(step.command, step.args);
        results.push(
          r.ok
            ? { command: step.command, ok: true, result: r.value }
            : { command: step.command, ok: false, error: r.error.message },
        );
      }
      return { ok: true, value: results };
    }
    return this.runOne(name, args);
  }

  private async runOne(name: string, args: unknown): Promise<RunOutcome> {
    const def = this.registry.get(name);
    if (def === undefined || !this.registry.isAvailable(def, this.ctx)) {
      return { ok: false, error: { message: `mcp: unknown or unavailable command '${name}'` } };
    }
    try {
      const value = await def.handler(this.ctx, args);
      if (def.mutating) this.ctx.audit.record({ time: timestamp(), command: name, args, ok: true });
      return { ok: true, value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (def.mutating) this.ctx.audit.record({ time: timestamp(), command: name, args, ok: false, error: message });
      const stack = err instanceof Error ? err.stack : undefined;
      return { ok: false, error: stack !== undefined ? { message, stack } : { message } };
    }
  }
}

/** Construct a {@link StudioBridge}. Call {@link StudioBridge.start} to connect. */
export const createStudioBridge = (
  registry: CommandRegistry,
  ctx: CommandContext,
  opts: StudioBridgeOptions,
): StudioBridge => new StudioBridge(registry, ctx, opts);
