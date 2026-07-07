import type { App, PluginObject } from '@retro-engine/engine';
import { MessageWriter, Res, ResMut, Time } from '@retro-engine/engine';

import { Touches } from './touch';
import {
  DEFAULT_TOUCH_GESTURE_CONFIG,
  PanGesture,
  PinchGesture,
  recognizeGestures,
  SwipeGesture,
  TapGesture,
  type TouchGestureConfig,
  TouchGestureState,
} from './touch-gestures';

/**
 * Opt-in plugin that recognizes tap + swipe gestures from {@link Touches} and
 * emits them as {@link TapGesture} / {@link SwipeGesture} messages. Runs in
 * `preUpdate` right after the input drain (`after: 'input'`), so the frame's
 * touch state is populated before classification. Read the gestures with
 * `MessageReader(TapGesture)` / `MessageReader(SwipeGesture)`. Requires
 * `InputPlugin` (which provides `Touches`).
 *
 * @example
 * ```ts
 * app.addPlugin(new InputPlugin());
 * app.addPlugin(new TouchGesturePlugin());
 * app.addSystem('update', [MessageReader(TapGesture)], (taps) => {
 *   for (const t of taps) fireAt(t.x, t.y);
 * });
 * ```
 */
export class TouchGesturePlugin implements PluginObject {
  private readonly config: TouchGestureConfig;

  constructor(config: Partial<TouchGestureConfig> = {}) {
    this.config = { ...DEFAULT_TOUCH_GESTURE_CONFIG, ...config };
  }

  name(): string {
    return 'TouchGesturePlugin';
  }

  build(app: App): void {
    if (app.getResource(TouchGestureState) === undefined) app.insertResource(new TouchGestureState());
    app.addMessage(TapGesture);
    app.addMessage(SwipeGesture);
    app.addMessage(PanGesture);
    app.addMessage(PinchGesture);
    const config = this.config;
    app.addSystem(
      'preUpdate',
      [
        Res(Touches),
        Res(Time),
        ResMut(TouchGestureState),
        MessageWriter(TapGesture),
        MessageWriter(SwipeGesture),
        MessageWriter(PanGesture),
        MessageWriter(PinchGesture),
      ],
      (touches, time, state, tapWriter, swipeWriter, panWriter, pinchWriter) => {
        const nowMs = (time as Time).real.elapsed * 1000;
        const { taps, swipes, pans, pinches } = recognizeGestures(
          touches as Touches,
          nowMs,
          state as TouchGestureState,
          config,
        );
        for (const tap of taps) (tapWriter as { write(m: TapGesture): void }).write(tap);
        for (const swipe of swipes) (swipeWriter as { write(m: SwipeGesture): void }).write(swipe);
        for (const pan of pans) (panWriter as { write(m: PanGesture): void }).write(pan);
        for (const pinch of pinches) (pinchWriter as { write(m: PinchGesture): void }).write(pinch);
      },
      { name: 'touch-gestures', label: 'touch-gestures', after: ['input'] },
    );
  }
}
