import type { CommandManifest, InvokeFrame, StudioToServerFrame } from '@retro-engine/mcp-protocol';
import { type RawData, type WebSocket as WsSocket, WebSocketServer } from 'ws';

/** How long to wait for the studio to answer an invoke before failing it. */
const INVOKE_TIMEOUT_MS = 30_000;

interface PendingInvoke {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * The relay's server end of the studio link: a localhost WebSocket server the
 * studio connects to. Holds the latest studio socket and its command catalog,
 * and round-trips invoke requests to it. One studio at a time (latest wins).
 */
export class StudioLink {
  private wss: WebSocketServer | null = null;
  private studio: WsSocket | null = null;
  private manifest: readonly CommandManifest[] = [];
  private seq = 0;
  private catalogListener: (() => void) | null = null;
  private readonly pending = new Map<number, PendingInvoke>();

  /** Start the WebSocket server. Resolves once it is listening (or rejects on bind failure). */
  listen(port: number, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host });
      this.wss = wss;
      wss.on('listening', () => resolve());
      wss.on('error', (err) => reject(err));
      wss.on('connection', (socket) => this.onConnection(socket));
    });
  }

  /** Register a callback fired whenever the studio's command catalog changes. */
  onCatalogChange(listener: () => void): void {
    this.catalogListener = listener;
  }

  get connected(): boolean {
    return this.studio !== null;
  }

  /** The bound port (after {@link listen}); 0 if not listening. Useful with an ephemeral port in tests. */
  get port(): number {
    const addr = this.wss?.address();
    return typeof addr === 'object' && addr !== null ? addr.port : 0;
  }

  get commands(): readonly CommandManifest[] {
    return this.manifest;
  }

  /** Run a command on the studio and resolve with its result (rejects if no studio / on error / timeout). */
  invoke(name: string, args: unknown): Promise<unknown> {
    const studio = this.studio;
    if (studio === null) {
      return Promise.reject(new Error('studio not connected — open the studio and enable the MCP bridge in the MCP panel'));
    }
    const id = ++this.seq;
    const frame: InvokeFrame = { type: 'invoke', id: String(id), name, args };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`command '${name}' timed out after ${INVOKE_TIMEOUT_MS}ms`));
      }, INVOKE_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        studio.send(JSON.stringify(frame));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  close(): void {
    this.wss?.close();
  }

  private onConnection(socket: WsSocket): void {
    // Latest studio wins; drop any previous connection so invokes target one editor.
    if (this.studio !== null && this.studio !== socket) {
      try {
        this.studio.close();
      } catch {
        // already closing
      }
    }
    this.studio = socket;
    socket.on('message', (data: RawData) => this.onMessage(data));
    socket.on('error', () => {
      // surfaced via the close that follows
    });
    socket.on('close', () => {
      if (this.studio !== socket) return;
      this.studio = null;
      this.manifest = [];
      this.catalogListener?.();
    });
  }

  private onMessage(data: RawData): void {
    let frame: StudioToServerFrame;
    try {
      frame = JSON.parse(data.toString()) as StudioToServerFrame;
    } catch {
      return;
    }
    if (frame.type === 'hello' || frame.type === 'catalog') {
      this.manifest = frame.commands;
      this.catalogListener?.();
      return;
    }
    if (frame.type === 'result') {
      const id = Number(frame.id);
      const entry = this.pending.get(id);
      if (entry === undefined) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (frame.ok) entry.resolve(frame.result);
      else entry.reject(new Error(frame.error.message));
    }
  }
}
