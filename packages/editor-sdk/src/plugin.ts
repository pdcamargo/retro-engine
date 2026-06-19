import { type App, type PluginObject, RenderSet } from '@retro-engine/engine';
import type { SurfaceOverlay } from '@retro-engine/renderer-core';

import { applyTheme } from './apply-theme';
import { enableDocking } from './docking';
import { type FontSpec, registerFonts } from './fonts';
import { flushLayoutChange, loadLayout } from './layout';
import { defaultTokens, type ThemeTokens } from './tokens';
import { ui, type Ui } from './ui';

/**
 * How the UI layout (window positions + dock tree) is seeded and persisted.
 * The sinks are consumer-provided so the layout can live wherever the host keeps
 * it — `localStorage`, a project file, etc.
 */
export interface UiLayoutOptions {
  /**
   * Layout `ini` applied when `restore` yields nothing — the default editor
   * layout. Produce one with `saveLayout()` after arranging windows once.
   */
  readonly default?: string;
  /** Return a previously-saved layout `ini`, or nullish for none. Called once at startup. */
  readonly restore?: () => string | null | undefined;
  /** Persist the layout `ini` when the user changes it. */
  readonly persist?: (ini: string) => void;
}

/** Options for {@link uiOverlayPlugin}. */
export interface UiOverlayOptions {
  /**
   * The backend overlay to drive, created from the App's active renderer (e.g.
   * `createImGuiOverlay(renderer)`). Injected the same way the renderer is, so
   * this package stays backend-neutral.
   */
  readonly overlay: SurfaceOverlay;
  /** The canvas the engine renders to; the overlay composites onto it. */
  readonly canvas: HTMLCanvasElement;
  /** Per-frame UI. Runs once each frame between the overlay's begin/end. */
  readonly draw: (ui: Ui) => void;
  /** Design tokens to style the UI. Defaults to {@link defaultTokens}. */
  readonly tokens?: ThemeTokens;
  /**
   * Enable window docking (drag windows together / into a host dockspace). When
   * true, draw a dockspace each frame with {@link Ui.dockSpaceOverViewport}.
   * Defaults to `false`.
   */
  readonly docking?: boolean;
  /**
   * Seed and persist the dock layout. Requires {@link docking}. See
   * {@link UiLayoutOptions}.
   */
  readonly layout?: UiLayoutOptions;
  /**
   * Fonts to register at startup. Async because font bytes are typically
   * fetched; resolved once during the overlay's init. The first spec flagged
   * `default` becomes the editor's default font.
   */
  readonly fonts?: () => Promise<readonly FontSpec[]>;
  /** Global base font size in pixels (`io.FontSizeBase`). Defaults to the binding's default. */
  readonly fontSizeBase?: number;
}

/**
 * Drives an immediate-mode UI overlay each frame, on top of the engine's render.
 *
 * Initialization is async (it waits on the overlay backend), so the plugin gates
 * `ready()` until the overlay is up; the per-frame draw runs in the render
 * `Cleanup` set, after the main render has been submitted, and no-ops until then.
 */
export class UiOverlayPlugin implements PluginObject {
  private readonly overlay: SurfaceOverlay;
  private readonly canvas: HTMLCanvasElement;
  private readonly draw: (ui: Ui) => void;
  private readonly tokens: ThemeTokens;
  private readonly docking: boolean;
  private readonly layout: UiLayoutOptions | undefined;
  private readonly fonts: (() => Promise<readonly FontSpec[]>) | undefined;
  private readonly fontSizeBase: number | undefined;
  private initStarted = false;
  private initDone = false;

  constructor(options: UiOverlayOptions) {
    this.overlay = options.overlay;
    this.canvas = options.canvas;
    this.draw = options.draw;
    this.tokens = options.tokens ?? defaultTokens;
    this.docking = options.docking ?? false;
    this.layout = options.layout;
    this.fonts = options.fonts;
    this.fontSizeBase = options.fontSizeBase;
  }

  name(): string {
    return 'UiOverlayPlugin';
  }

  category(): 'editor' {
    return 'editor';
  }

  build(app: App): void {
    app.addSystem(
      'render',
      [],
      () => {
        if (!this.initDone) return;
        const surface = app.getSurface();
        if (surface === undefined) return;
        this.overlay.beginFrame();
        this.draw(ui);
        if (this.layout?.persist !== undefined) flushLayoutChange(this.layout.persist);
        this.overlay.endFrame(surface);
      },
      { set: RenderSet.Cleanup, label: 'ui-overlay' },
    );
  }

  ready(app: App): boolean {
    if (!this.initStarted) {
      this.initStarted = true;
      this.setup().catch((err: unknown) => {
        app.logger.error(`UiOverlayPlugin: overlay init failed: ${String(err)}`);
      });
    }
    return this.initDone;
  }

  private async setup(): Promise<void> {
    await this.overlay.init(this.canvas);
    if (this.docking) enableDocking();
    if (this.fonts !== undefined) {
      const specs = await this.fonts();
      registerFonts((name, data) => this.overlay.loadFont(name, data), specs, this.fontSizeBase);
    }
    if (this.layout !== undefined) {
      const ini = this.layout.restore?.() ?? this.layout.default;
      if (ini !== undefined && ini !== null) loadLayout(ini);
    }
    applyTheme(this.tokens);
    this.initDone = true;
  }
}

/** Construct a {@link UiOverlayPlugin}. See {@link UiOverlayOptions}. */
export const uiOverlayPlugin = (options: UiOverlayOptions): UiOverlayPlugin =>
  new UiOverlayPlugin(options);
