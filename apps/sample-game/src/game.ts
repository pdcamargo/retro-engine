import { quat, vec2, vec3, vec4 } from '@retro-engine/math';
import type { App, PluginObject } from '@retro-engine/engine';
import {
  Camera2d,
  ClearColorConfig,
  Commands,
  installDefaultFont,
  Query,
  ResMut,
  Text2d,
  TextPlugin,
  Time,
  Transform,
} from '@retro-engine/engine';
import { defineProject } from '@retro-engine/project';
import { UiNode, UiPlugin, UiRenderPlugin, UiText } from '@retro-engine/ui';

/** Marker: rotate this entity about its Z axis each frame. */
class Spin {
  constructor(public readonly speed: number = 0.8) {}
}

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
    const font = installDefaultFont(app);

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
  }
}

export default defineProject({
  plugins: [new HelloTextPlugin()],
  meta: { name: 'Retro Engine Sample' },
});
