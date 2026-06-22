/**
 * The wire protocol spoken between the studio's in-process MCP bridge (browser /
 * Tauri webview) and the `studio-mcp-server` relay (a node/bun process the AI
 * client launches). The relay owns a localhost WebSocket server; the studio is a
 * reconnecting client. Messages are JSON frames in both directions.
 */

/** Current wire-protocol revision. Bumped on any breaking frame change. */
export const MCP_PROTOCOL_VERSION = 1;

/** Default localhost port the relay binds and the studio connects to. */
export const STUDIO_MCP_DEFAULT_PORT = 8787;

/**
 * Reserved command name the relay sends to run several commands in one round
 * trip. The bridge unrolls it; it never appears in a command catalog.
 */
export const BATCH_COMMAND = '$batch';

/**
 * A minimal JSON Schema subset, enough to describe command arguments to an MCP
 * client. Mirrors the shape MCP advertises as a tool's `inputSchema`.
 */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean | JsonSchema;
}

/** A single command, as advertised to the relay (and through it, to the MCP client as a tool). */
export interface CommandManifest {
  /** Unique command id, e.g. `entity.spawn`. Becomes the MCP tool name. */
  readonly name: string;
  /** Short human title. */
  readonly title: string;
  /** One-line description shown to the AI as the tool description. */
  readonly description: string;
  /** Grouping domain, e.g. `entity`, `scene`, `studio`. */
  readonly domain: string;
  /** Whether the command writes editor/scene state (vs a pure read). */
  readonly mutating: boolean;
  /** JSON Schema for the command's arguments. */
  readonly inputSchema: JsonSchema;
}

/** Identifies the studio session to the relay (for status / logging). */
export interface StudioInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly projectDir: string | null;
}

/** First frame the studio sends on connect: who it is + its full command catalog. */
export interface HelloFrame {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly studio: StudioInfo;
  readonly commands: readonly CommandManifest[];
}

/** Sent by the studio when its catalog changes (e.g. eval toggled, plugin added commands). */
export interface CatalogFrame {
  readonly type: 'catalog';
  readonly commands: readonly CommandManifest[];
}

/** Relay → studio: run one command (or the `$batch` pseudo-command). */
export interface InvokeFrame {
  readonly type: 'invoke';
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

/** Studio → relay: a command succeeded. */
export interface ResultOkFrame {
  readonly type: 'result';
  readonly id: string;
  readonly ok: true;
  readonly result: unknown;
}

/** Studio → relay: a command failed. */
export interface ResultErrFrame {
  readonly type: 'result';
  readonly id: string;
  readonly ok: false;
  readonly error: { readonly message: string; readonly stack?: string };
}

export type ResultFrame = ResultOkFrame | ResultErrFrame;

/** Anything the studio may send to the relay. */
export type StudioToServerFrame = HelloFrame | CatalogFrame | ResultFrame;

/** Anything the relay may send to the studio. */
export type ServerToStudioFrame = InvokeFrame;

/** One step of a `$batch` invoke. */
export interface BatchStep {
  readonly command: string;
  readonly args?: unknown;
}

/** Per-step result of a `$batch` invoke, in input order. */
export interface BatchStepResult {
  readonly command: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}
