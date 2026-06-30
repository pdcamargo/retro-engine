import type { AssetSink, AssetSource } from '@retro-engine/assets';
import type { Entity, World } from '@retro-engine/ecs';
import type { EntityClassifier, Editor, History } from '@retro-engine/editor-sdk';
import type { App, AppTypeRegistry, AssetServer } from '@retro-engine/engine';
import type { TypeRegistry } from '@retro-engine/reflect';

/** One recorded log line, as surfaced to the `logs.recent` command. */
export interface LogRecord {
  readonly time: string;
  readonly level: string;
  readonly text: string;
  readonly meta?: string;
}

/** A bounded source of recent log lines, owned by the studio. */
export interface LogSink {
  recent(limit?: number): readonly LogRecord[];
}

/** One audited mutating command, newest entries last. */
export interface AuditRecord {
  readonly time: string;
  readonly command: string;
  readonly args: unknown;
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * A bounded ring of mutating-command invocations, so the user can see at a glance
 * what an AI just did (surfaced by the MCP panel and the `studio.audit` command).
 */
export class AuditLog {
  private readonly buffer: AuditRecord[] = [];

  constructor(private readonly capacity = 200) {}

  record(entry: AuditRecord): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  recent(limit = 50): readonly AuditRecord[] {
    return limit >= this.buffer.length ? [...this.buffer] : this.buffer.slice(this.buffer.length - limit);
  }
}

/**
 * The slice of mutable editor state commands read and write. The studio's full
 * state object structurally satisfies this; only {@link selectedEntity} is
 * written back (selection), the rest are read for status.
 */
export interface StudioEditorState {
  selectedEntity: Entity | null;
  readonly debugMode: boolean;
  readonly dirty: boolean;
  readonly playing: boolean;
  readonly paused: boolean;
  readonly viewMode: string;
}

/** The read + write file pair for the open project (mirrors the studio's `ProjectIo`). */
export interface ProjectIoLike {
  readonly source: AssetSource;
  readonly sink: AssetSink;
}

/** Result of a {@link CommandContext.saveScene}. */
export type SaveSceneResult = { readonly entities: number } | { readonly error: string };

/** A captured image (base64 PNG, no data: prefix) and its pixel dimensions. */
export interface CaptureResult {
  readonly image: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

/** The Entity Composer modal, driven by the studio. */
export interface ComposerControl {
  /** Open the composer in a mode, optionally targeting an entity (for 'add'). */
  open(mode: 'create' | 'add' | 'bundle', target?: number): void;
  /** Close the composer. */
  close(): void;
  isOpen(): boolean;
  mode(): string;
}

/** Screenshot capability provided by the studio (the webview owns the canvas). */
export interface CaptureService {
  /** Capture the whole editor canvas, downscaled so its width is at most `maxWidth`. */
  editor(maxWidth?: number): Promise<CaptureResult>;
  /** Capture a single panel by id (its last drawn window rect), or null if unknown. */
  panel(id: string, maxWidth?: number): Promise<CaptureResult | null>;
  /** Panel ids with a recorded rect this session (capturable). */
  panelIds(): readonly string[];
}

/**
 * Everything a command needs to act on the live studio. The studio builds one of
 * these at boot and hands it to {@link createStudioBridge}; commands close over
 * nothing else, so they stay decoupled from the studio's private modules.
 */
export interface CommandContext {
  readonly app: App;
  readonly world: World;
  /** The reflection registry (`AppTypeRegistry.registry`). */
  readonly registry: TypeRegistry;
  readonly types: AppTypeRegistry;
  readonly editor: Editor;
  readonly history: History;
  readonly state: StudioEditorState;
  readonly logs: LogSink;
  readonly audit: AuditLog;
  readonly assetServer: AssetServer | undefined;
  readonly projectIo: ProjectIoLike | null;
  /** Entity-outline classifiers (the studio's, including project types). */
  readonly classifiers: readonly EntityClassifier[] | undefined;
  /** Whether an entity is editor scaffolding (camera, grid, gizmo) rather than authored content. */
  isEditorEntity(entity: Entity): boolean;
  /** Whether `studio.eval` is currently permitted (the MCP panel's "Allow eval" toggle). */
  allowEval(): boolean;
  /** Screenshot capability (the studio provides it; absent in headless contexts). */
  readonly capture?: CaptureService;
  /** The Entity Composer modal (the studio provides it). */
  readonly composer?: ComposerControl;
  /** Persist the current scene, if a project is open. */
  saveScene?(): Promise<SaveSceneResult>;
  /**
   * Rescan the open project's assets so a just-written file is in the manifest and
   * the browser. Provided by the studio; absent in headless contexts.
   */
  reindexAssets?(): Promise<void>;
}
