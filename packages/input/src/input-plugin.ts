import type { App, PluginObject } from '@retro-engine/engine';
import { ResMut } from '@retro-engine/engine';

import { DomInputBackend, HeadlessInputBackend } from './dom-backend';
import type { DomInputBackendOptions } from './dom-backend';
import { KeyboardInput } from './keyboard';
import {
  CursorPosition,
  MouseButtonInput,
  MouseMotion,
  MouseScroll,
  mouseButtonFromIndex,
} from './mouse';
import type { InputBackend } from './raw-event';

/** Options for {@link InputPlugin}. */
export interface InputPluginOptions {
  /**
   * Backend to capture input through. Defaults to a {@link DomInputBackend}
   * when a `window` is present, otherwise a {@link HeadlessInputBackend} (so
   * tests and server worlds run unchanged). Pass an explicit backend to target
   * a specific canvas or a custom platform.
   */
  readonly backend?: InputBackend;
  /**
   * Element cursor positions are reported relative to (typically the game
   * canvas). Ignored when {@link InputPluginOptions.backend} is supplied.
   */
  readonly pointerTarget?: HTMLElement;
  /**
   * Whether the default DOM backend calls `preventDefault()` on wheel /
   * context-menu events. Ignored when a `backend` is supplied. Defaults true.
   */
  readonly preventDefaults?: boolean;
}

/**
 * Registers the input resources and the once-per-frame system that feeds them
 * from a backend. Add it to an `App`, then read input through
 * `Res(KeyboardInput)`, `Res(MouseButtonInput)`, `Res(MouseMotion)`,
 * `Res(MouseScroll)`, and `Res(CursorPosition)`.
 *
 * Not part of `CorePlugin`: attaching global DOM listeners is a host decision,
 * so the studio, playground, or a game opts in explicitly. Headless-safe — with
 * no `window` present it installs a no-op backend.
 *
 * @example
 * ```ts
 * import { InputPlugin } from '@retro-engine/input';
 * app.addPlugin(new InputPlugin({ pointerTarget: canvas }));
 * ```
 */
export class InputPlugin implements PluginObject {
  private readonly backend: InputBackend;

  constructor(options: InputPluginOptions = {}) {
    if (options.backend !== undefined) {
      this.backend = options.backend;
    } else if (typeof window !== 'undefined') {
      const domOpts: DomInputBackendOptions = {
        ...(options.pointerTarget !== undefined ? { pointerTarget: options.pointerTarget } : {}),
        ...(options.preventDefaults !== undefined ? { preventDefaults: options.preventDefaults } : {}),
      };
      this.backend = new DomInputBackend(domOpts);
    } else {
      this.backend = new HeadlessInputBackend();
    }
  }

  name(): string {
    return 'InputPlugin';
  }

  build(app: App): void {
    app.insertResource(new KeyboardInput());
    app.insertResource(new MouseButtonInput());
    app.insertResource(new MouseMotion());
    app.insertResource(new MouseScroll());
    app.insertResource(new CursorPosition());

    this.backend.attach();

    const backend = this.backend;
    app.addSystem(
      'preUpdate',
      [
        ResMut(KeyboardInput),
        ResMut(MouseButtonInput),
        ResMut(MouseMotion),
        ResMut(MouseScroll),
        ResMut(CursorPosition),
      ],
      (keyboard, mouseButtons, motion, scroll, cursor) => {
        applyInputFrame(backend, keyboard, mouseButtons, motion, scroll, cursor);
      },
      { name: 'input-update', label: 'input' },
    );
  }

  /**
   * The backend this plugin drives. Exposed so a host can {@link InputBackend.detach}
   * it on teardown (there is no plugin-stop lifecycle hook yet).
   */
  getBackend(): InputBackend {
    return this.backend;
  }
}

/**
 * Advance input state by one frame: drop the previous frame's transient button
 * transitions and per-frame accumulators, then apply this frame's queued events
 * so `justPressed` / `justReleased` reflect only the current frame. Exported for
 * the bench and tests; the plugin's `preUpdate` system is the only caller in an
 * App.
 *
 * @internal
 */
export const applyInputFrame = (
  backend: InputBackend,
  keyboard: KeyboardInput,
  mouseButtons: MouseButtonInput,
  motion: MouseMotion,
  scroll: MouseScroll,
  cursor: CursorPosition,
): void => {
  keyboard.clear();
  mouseButtons.clear();
  motion.clear();
  scroll.clear();

  for (const ev of backend.drain()) {
    switch (ev.kind) {
      case 'key-down':
        keyboard.press(ev.code);
        break;
      case 'key-up':
        keyboard.release(ev.code);
        break;
      case 'mouse-down': {
        const button = mouseButtonFromIndex(ev.button);
        if (button !== null) mouseButtons.press(button);
        break;
      }
      case 'mouse-up': {
        const button = mouseButtonFromIndex(ev.button);
        if (button !== null) mouseButtons.release(button);
        break;
      }
      case 'mouse-move':
        cursor.x = ev.x;
        cursor.y = ev.y;
        cursor.present = ev.present;
        motion.x += ev.dx;
        motion.y += ev.dy;
        break;
      case 'wheel':
        scroll.x += ev.dx;
        scroll.y += ev.dy;
        scroll.unit = ev.unit;
        break;
      case 'cursor-leave':
        cursor.present = false;
        break;
      case 'blur':
        keyboard.releaseAll();
        mouseButtons.releaseAll();
        break;
    }
  }
};
