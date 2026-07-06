import { quat, type Vec4, vec2, vec3, vec4 } from '@retro-engine/math';
import type { App, PluginObject } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  installDefaultFont,
  MessageReader,
  Query,
  ResMut,
  Text2d,
  TextPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';
import { InputPlugin } from '@retro-engine/input';
import { defineProject } from '@retro-engine/project';
import {
  Interactable,
  UiClicked,
  UiInteraction,
  UiNode,
  UiPlugin,
  UiRenderPlugin,
  UiInteractionPlugin,
  UiText,
} from '@retro-engine/ui';

/** Marker: rotate this entity about its Z axis each frame. */
class Spin {
  constructor(public readonly speed: number = 0.8) {}
}

/** Marker: the clickable button node. */
class ClickButton {}

/** State + marker: the label node showing the click count. */
class ClickCounter {
  count = 0;
}

/** Set a UI node's background at runtime (the resolved style is otherwise readonly). */
const setBackground = (node: UiNode, color: Vec4): void => {
  (node.style as { backgroundColor: Vec4 }).backgroundColor = color;
};

/**
 * The whole sample game: a 2D camera, a title, a HUD line, and a spinning label,
 * all drawn with the engine's built-in default font (no external assets). It is
 * deliberately asset-free so it exports and runs from a single bundle — the
 * smoke test for the web export pipeline.
 */
class HelloTextPlugin implements PluginObject {
  name(): string {
    return 'HelloTextPlugin';
  }

  build(app: App): void {
    app.addPlugin(new TextPlugin());
    app.addPlugin(new UiPlugin());
    app.addPlugin(new UiRenderPlugin());
    app.addPlugin(new InputPlugin());
    app.addPlugin(new UiInteractionPlugin());
    const font = installDefaultFont(app);

    const IDLE = vec4.create(0.24, 0.28, 0.42, 1);
    const HOVER = vec4.create(0.34, 0.4, 0.6, 1);
    const PRESSED = vec4.create(0.16, 0.19, 0.3, 1);

    app.addSystem(
      'startup',
      [Commands],
      (cmd) => {
        cmd.spawn(
          new Text2d({
            text: 'RETRO ENGINE',
            font,
            fontSize: 72,
            color: vec4.create(1, 1, 1, 1),
            anchor: vec2.create(0.5, 0.5),
          }),
          new Transform(vec3.create(0, 160, 0)),
        );
        cmd.spawn(
          new Text2d({
            text: 'WEB EXPORT OK',
            font,
            fontSize: 40,
            color: vec4.create(0.5, 0.9, 1, 1),
            anchor: vec2.create(0.5, 0.5),
          }),
          new Transform(vec3.create(0, 40, 0)),
        );
        cmd.spawn(
          new Text2d({
            text: 'SPIN!',
            font,
            fontSize: 56,
            color: vec4.create(0.6, 1, 0.6, 1),
            anchor: vec2.create(0.5, 0.5),
          }),
          new Transform(vec3.create(0, -140, 0)),
          new Spin(),
        );
        cmd.spawn(
          ...Camera2d({ clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.06, b: 0.1, a: 1 }) }),
        );
      },
      { label: 'hello-text-setup' },
    );

    // A bottom-right HUD panel built from flex UI nodes with background fills,
    // composited over the scene by the screen-space UI overlay pass.
    app.addSystem(
      'startup',
      [Commands],
      (cmd) => {
        cmd
          .spawn(
            new UiNode({
              width: undefined,
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'flex-end',
              padding: 24,
              flexGrow: 1,
            }),
          )
          .withChildren((root) => {
            root
              .spawn(
                new UiNode({
                  width: 320,
                  height: 160,
                  flexDirection: 'column',
                  padding: 12,
                  gap: 8,
                  backgroundColor: vec4.create(0.12, 0.14, 0.2, 0.85),
                }),
              )
              .withChildren((panel) => {
                panel.spawn(
                  new UiNode({ height: 40, padding: { left: 10, top: 8 }, backgroundColor: vec4.create(0.95, 0.55, 0.2, 1) }),
                  new UiText({ text: 'STATUS', font, fontSize: 22, color: vec4.create(0.08, 0.06, 0.04, 1) }),
                );
                panel.spawn(
                  new UiNode({ flexGrow: 1, padding: { left: 10, top: 10 }, backgroundColor: vec4.create(0.2, 0.6, 0.35, 0.95) }),
                  new UiText({ text: 'HP 100  MP 42', font, fontSize: 26, color: vec4.create(1, 1, 1, 1) }),
                );
              });
          });
      },
      { label: 'hello-ui-setup' },
    );

    // A centered, clickable button + a click counter label — the interaction demo.
    app.addSystem(
      'startup',
      [Commands],
      (cmd) => {
        cmd
          .spawn(
            new UiNode({
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 16,
              flexGrow: 1,
            }),
          )
          .withChildren((root) => {
            root.spawn(
              new UiNode({ padding: { left: 6, top: 4 } }),
              new UiText({ text: 'CLICKS: 0', font, fontSize: 30, color: vec4.create(0.9, 0.9, 1, 1) }),
              new ClickCounter(),
            );
            root.spawn(
              new UiNode({ width: 260, height: 72, padding: { left: 22, top: 22 }, backgroundColor: IDLE }),
              new UiText({ text: 'CLICK ME', font, fontSize: 28, color: vec4.create(1, 1, 1, 1) }),
              new Interactable(),
              new ClickButton(),
            );
          });
      },
      { label: 'click-demo-setup' },
    );

    app.addSystem(
      'update',
      [Query([Transform, Spin]), ResMut(Time)],
      (spinners, time) => {
        const dt = (time as Time).virtual.delta;
        for (const [entity, transform] of spinners.entries()) {
          const delta = quat.create();
          quat.fromAxisAngle(vec3.create(0, 0, 1), 0.8 * dt, delta);
          quat.multiply(delta, (transform as Transform).rotation, (transform as Transform).rotation);
          app.world.markChanged(entity, Transform);
        }
      },
      { label: 'hello-text-spin' },
    );

    // Tint the button by its interaction state.
    app.addSystem(
      'update',
      [Query([UiNode, UiInteraction, ClickButton])],
      (buttons) => {
        for (const row of buttons.entries()) {
          const node = row[1] as UiNode;
          const state = (row[2] as UiInteraction).state;
          setBackground(node, state === 'pressed' ? PRESSED : state === 'hovered' ? HOVER : IDLE);
        }
      },
      { label: 'click-demo-tint' },
    );

    // Count clicks and update the counter label + a window probe.
    app.addSystem(
      'update',
      [MessageReader(UiClicked), Query([UiText, ClickCounter])],
      (clicks, counters) => {
        let n = 0;
        for (const _ of clicks) n += 1;
        if (n === 0) return;
        for (const row of counters.entries()) {
          const text = row[1] as UiText;
          const counter = row[2] as ClickCounter;
          counter.count += n;
          text.text = `CLICKS: ${counter.count}`;
          if (typeof window !== 'undefined') {
            (window as unknown as { __game: { clicks: number } }).__game = { clicks: counter.count };
          }
        }
      },
      { label: 'click-demo-count' },
    );
  }
}

export default defineProject({
  plugins: [new HelloTextPlugin()],
  meta: { name: 'Retro Engine Sample' },
});
