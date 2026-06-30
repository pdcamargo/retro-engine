// Studio ↔ MCP wiring. Builds the command registry + bridge that lets an AI
// client (through the studio-mcp-server relay) drive the live editor, and the
// log/audit buffers the MCP commands read. The MCP panel (panels-mcp.ts) is the
// user-facing control surface; this module owns the runtime.

import type { Entity } from '@retro-engine/ecs';
import type { EntityClassifier, Editor, History } from '@retro-engine/editor-sdk';
import {
  App,
  AppTypeRegistry,
  AssetServer,
  createConsoleLogger,
  type Logger,
} from '@retro-engine/engine';
import {
  AuditLog,
  type AuditRecord,
  type BridgeStatus,
  type CaptureService,
  type CommandContext,
  type ComposerControl,
  CommandRegistry,
  createDefaultRegistry,
  createStudioBridge,
  type LogRecord,
  type LogSink,
  type SaveSceneResult,
  StudioBridge,
} from '@retro-engine/editor-mcp';
import type { PreferenceStore } from '@retro-engine/editor-platform';
import { RETRO_STUDIO_SKILL_MD, STUDIO_MCP_DEFAULT_PORT, type StudioInfo } from '@retro-engine/mcp-protocol';

import type { ProjectIo } from './project/project-io';
import type { StudioState } from './state';

const time = (): string => new Date().toLocaleTimeString('en-US', { hour12: false });

/** A bounded in-memory log buffer the `logs.recent` command reads. */
export class LogRing implements LogSink {
  private readonly buffer: LogRecord[] = [];

  constructor(private readonly capacity = 500) {}

  push(level: string, text: string, meta?: string): void {
    this.buffer.push(meta !== undefined ? { time: time(), level, text, meta } : { time: time(), level, text });
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  recent(limit = 50): readonly LogRecord[] {
    return limit >= this.buffer.length ? [...this.buffer] : this.buffer.slice(this.buffer.length - limit);
  }
}

/** A {@link Logger} that records into a {@link LogRing} while still writing to the console. */
export const createTeeLogger = (ring: LogRing): Logger => {
  const tee = (prefix: string, inner: Logger): Logger => ({
    error: (m) => {
      ring.push('err', prefix + m);
      inner.error(m);
    },
    warn: (m) => {
      ring.push('warn', prefix + m);
      inner.warn(m);
    },
    info: (m) => {
      ring.push('info', prefix + m);
      inner.info(m);
    },
    debug: (m) => {
      ring.push('info', prefix + m);
      inner.debug(m);
    },
    devWarn: (m) => inner.devWarn(m),
    child: (category) => tee(`${prefix}[${category}] `, inner.child(category)),
  });
  return tee('', createConsoleLogger());
};

/**
 * The one-time command that registers the relay with Claude Code at user scope
 * (so it works from any project). The studio can't write `~/.claude.json` itself
 * (its file IO is sandboxed to the open project and it doesn't know the relay's
 * path), so it hands the user this command to run from the engine repo. The relay
 * is not published to npm, so this is a local `bun` invocation.
 */
export const MCP_SETUP_COMMAND = 'bun run packages/studio-mcp-server/src/cli.ts install';

/** Where the studio installs the usage skill within the open project. */
const SKILL_LOCATION = '.claude/skills/retro-studio/SKILL.md';

/** What the studio hands the MCP runtime once the platform host + project are resolved. */
export interface StudioMcpAttachDeps {
  readonly app: App;
  readonly editor: Editor;
  readonly history: History;
  readonly state: StudioState;
  readonly prefs: PreferenceStore;
  readonly projectIo: ProjectIo | null;
  readonly capture: CaptureService;
  readonly composer: ComposerControl;
  readonly classifiers: readonly EntityClassifier[];
  readonly isEditorEntity: (entity: Entity) => boolean;
  readonly studio: StudioInfo;
  readonly saveScene?: () => Promise<SaveSceneResult>;
  readonly reindexAssets?: () => Promise<void>;
}

const defaultEnabled = (): boolean =>
  (globalThis as { __studioMcpDefaultEnabled?: boolean }).__studioMcpDefaultEnabled !== false;

/**
 * The studio's MCP runtime. Created at boot (so the MCP panel can reference it),
 * then {@link attach}ed once the platform host + project are known. Panel-facing
 * methods are safe to call before attach (they report a quiescent state).
 */
export class StudioMcp {
  readonly audit = new AuditLog();
  /** The log buffer commands read; share it with the App logger via {@link createTeeLogger}. */
  readonly logs: LogRing;
  private registry: CommandRegistry = createDefaultRegistry();
  private bridge: StudioBridge | null = null;
  private status: BridgeStatus | null = null;
  private projectIo: ProjectIo | null = null;
  private evalAllowed = false;
  private enabledFlag = false;
  private portValue = STUDIO_MCP_DEFAULT_PORT;
  private prefs: PreferenceStore | null = null;
  private attached = false;

  constructor(logs: LogRing) {
    this.logs = logs;
  }

  /** Wire the runtime to the live studio and start the bridge if enabled by preference. */
  async attach(deps: StudioMcpAttachDeps): Promise<void> {
    this.prefs = deps.prefs;
    this.projectIo = deps.projectIo;
    const types = deps.app.getResource(AppTypeRegistry);
    if (types === undefined) {
      console.error('[studio] MCP: AppTypeRegistry missing — bridge not started');
      return;
    }

    const enabledPref = await deps.prefs.get('mcp.enabled');
    const evalPref = await deps.prefs.get('mcp.eval');
    const portPref = await deps.prefs.get('mcp.port');
    this.enabledFlag = enabledPref === null ? defaultEnabled() : enabledPref === 'true';
    this.evalAllowed = evalPref === null ? defaultEnabled() : evalPref === 'true';
    this.portValue = portPref !== null && Number.isFinite(Number(portPref)) ? Number(portPref) : STUDIO_MCP_DEFAULT_PORT;

    const ctx: CommandContext = {
      app: deps.app,
      world: deps.app.world,
      registry: types.registry,
      types,
      editor: deps.editor,
      history: deps.history,
      state: deps.state,
      logs: this.logs,
      audit: this.audit,
      assetServer: deps.app.getResource(AssetServer),
      projectIo: deps.projectIo,
      capture: deps.capture,
      composer: deps.composer,
      classifiers: deps.classifiers,
      isEditorEntity: deps.isEditorEntity,
      allowEval: () => this.evalAllowed,
      ...(deps.saveScene !== undefined ? { saveScene: deps.saveScene } : {}),
      ...(deps.reindexAssets !== undefined ? { reindexAssets: deps.reindexAssets } : {}),
    };

    this.bridge = createStudioBridge(this.registry, ctx, {
      port: this.portValue,
      studio: deps.studio,
      onStatusChange: (s) => {
        this.status = s;
      },
    });
    this.attached = true;
    if (this.enabledFlag) this.bridge.start();
  }

  /**
   * Invoke an editor command by name against the live studio — the same path an
   * AI client takes (routes through editor History + the audit ring). Studio UI
   * actions (drag-and-drop, toolbar) use this so they undo and audit identically.
   * Rejects if the runtime is not attached or the command fails.
   */
  async run(name: string, args: unknown): Promise<unknown> {
    if (this.bridge === null) throw new Error('studio MCP not attached');
    return this.bridge.run(name, args);
  }

  // ---- panel-facing API ----

  isAttached(): boolean {
    return this.attached;
  }

  enabled(): boolean {
    return this.enabledFlag;
  }

  connected(): boolean {
    return this.status?.connected ?? false;
  }

  port(): number {
    return this.portValue;
  }

  lastError(): string | null {
    return this.status?.lastError ?? null;
  }

  evalEnabled(): boolean {
    return this.evalAllowed;
  }

  recentAudit(limit = 12): readonly AuditRecord[] {
    return this.audit.recent(limit);
  }

  setEnabled(on: boolean): void {
    this.enabledFlag = on;
    void this.prefs?.set('mcp.enabled', String(on));
    if (this.bridge === null) return;
    if (on) this.bridge.start();
    else this.bridge.stop();
  }

  setEvalAllowed(on: boolean): void {
    this.evalAllowed = on;
    void this.prefs?.set('mcp.eval', String(on));
    this.bridge?.refreshCatalog();
  }

  /** Install the usage skill into the open project's `.claude/skills`. Returns the path, or null with no project. */
  async installSkill(): Promise<string | null> {
    if (this.projectIo === null) return null;
    await this.projectIo.sink.write(SKILL_LOCATION, new TextEncoder().encode(RETRO_STUDIO_SKILL_MD));
    return SKILL_LOCATION;
  }
}
