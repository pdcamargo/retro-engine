import type { Entity } from '@retro-engine/ecs';
import { quat, vec2, vec3, vec4 } from '@retro-engine/math';
import type { App, Handle, PluginObject } from '@retro-engine/engine';
import {
  Assets,
  AssetServer,
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
  ComputedLayout,
  Disabled,
  Interactable,
  setUiStyleSheet,
  setUiThemeVars,
  UiButton,
  UiClass,
  UiClicked,
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

/** The action a menu button represents. */
class MenuAction {
  constructor(public readonly name: string) {}
}

/** Marker: the label showing the last chosen menu action. */
class MenuLast {}

/** Marker: the label reflecting a packed asset loaded from the exported `.rpak`. */
class CreditsLabel {}

/**
 * A `.rss` (USS-subset) stylesheet driving the top-left chip strip at runtime:
 * `:root` custom properties (`--vars`) referenced via `var()`, a base `.chip`
 * rule, a `.chip.alt` compound override, and a `.chip:hovered` pseudo-class rule
 * — the end-to-end proof that the parsed stylesheet cascades onto live `UiClass`
 * nodes, resolves variables, and reacts to hover state.
 */
const SAMPLE_RSS = `
  :root {
    --accent: rgb(40, 120, 210);
    --alt: rgb(240, 150, 40);
    --hot: rgb(240, 60, 60);
    --chip-border: rgb(200, 220, 255);
  }
  #rss-panel { flex-direction: row; justify-content: flex-start; align-items: flex-start; padding: 16; gap: 12; flex-grow: 1; }
  .chip { width: 96; height: 64; border: 3 solid var(--chip-border); background-color: var(--accent); }
  .chip.alt { background-color: var(--alt); }
  .chip:hovered { background-color: var(--hot); }
`;

/** Merge a patch into the `window.__game` probe (shared across demo systems). */
const setGameProbe = (patch: Record<string, unknown>): void => {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __game?: Record<string, unknown> };
  w.__game = { ...w.__game, ...patch };
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

    // Make the sample `.rss` the active stylesheet — chips below carry only
    // `UiClass` selectors and get their whole style (size, border, fill, hover)
    // from this sheet at runtime.
    setUiStyleSheet(app, SAMPLE_RSS);

    // Expose runtime re-theming for verification: overriding `--accent` recolors
    // every `var(--accent)` usage on the next layout pass.
    if (typeof window !== 'undefined') {
      (window as unknown as { __setAccent: (c: string) => void }).__setAccent = (c) =>
        setUiThemeVars(app, { '--accent': c });
    }

    // Load a packed asset from the exported `.rpak` (present only when run from a
    // web export, where bootWebGame wires the RpakAssetSource + manifest). A tiny
    // text loader decodes the bytes; the credits label reflects the loaded value.
    const texts = new Assets<string>();
    let creditsHandle: Handle<string> | undefined;
    let creditsShown = false;
    app.whenResource(AssetServer, (server) => {
      server.registerLoader('txt', texts, (bytes) => new TextDecoder().decode(bytes));
      try {
        const guid = 'sample-credits-0001' as Parameters<typeof server.loadByGuid>[0];
        creditsHandle = server.loadByGuid<string>(guid);
      } catch {
        // No manifest/asset (running unpacked) — the label stays at its default.
      }
    });

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
                  borderWidth: 2,
                  borderColor: vec4.create(0.45, 0.55, 0.75, 1),
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

    // A centered vertical menu of UiButton widgets (one Disabled) + a label
    // reporting the last chosen action — the widget/interaction demo.
    const menuButton = (
      root: { spawn: (...c: object[]) => unknown },
      name: string,
      disabled = false,
    ): void => {
      const parts: object[] = [
        new UiNode({
          width: 300,
          height: 56,
          padding: { left: 20, top: 15 },
          borderWidth: 2,
          borderColor: vec4.create(0.62, 0.7, 0.95, 1),
        }),
        new UiText({ text: name, font, fontSize: 28, color: vec4.create(1, 1, 1, 1) }),
        new UiButton(),
        new MenuAction(name),
      ];
      if (disabled) parts.push(new Disabled());
      root.spawn(...parts);
    };

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
              gap: 14,
              flexGrow: 1,
            }),
          )
          .withChildren((root) => {
            root.spawn(
              new UiNode({ padding: { left: 6, top: 4 } }),
              new UiText({ text: 'MAIN MENU', font, fontSize: 34, color: vec4.create(0.9, 0.9, 1, 1) }),
            );
            menuButton(root, 'NEW GAME');
            menuButton(root, 'LOAD (SOON)', true);
            menuButton(root, 'QUIT');
            root.spawn(
              new UiNode({ padding: { left: 6, top: 4 } }),
              new UiText({ text: 'LAST: —', font, fontSize: 24, color: vec4.create(0.6, 1, 0.7, 1) }),
              new MenuLast(),
            );
            root.spawn(
              new UiNode({ padding: { left: 6, top: 4 } }),
              new UiText({ text: 'CREDITS: —', font, fontSize: 20, color: vec4.create(0.8, 0.8, 0.95, 1) }),
              new CreditsLabel(),
            );
          });
      },
      { label: 'menu-setup' },
    );

    // A top-left strip of chips styled entirely by `.rss` (no inline UiStyle):
    // one plain, one `.alt` (compound-selector override), one interactive whose
    // fill flips to the `:hovered` rule when the pointer is over it.
    app.addSystem(
      'startup',
      [Commands],
      (cmd) => {
        cmd
          .spawn(new UiNode(), new UiClass({ name: 'rss-panel' }))
          .withChildren((root) => {
            root.spawn(new UiNode(), new UiClass({ classes: ['chip'] }));
            root.spawn(new UiNode(), new UiClass({ classes: ['chip', 'alt'] }));
            root.spawn(new UiNode(), new UiClass({ classes: ['chip', 'hot'] }), new Interactable());
          });
      },
      { label: 'rss-chips-setup' },
    );

    // Report each `.rss` chip's resolved fill + screen center to a probe, so a
    // browser test can confirm the stylesheet drives paint and reacts to hover.
    app.addSystem(
      'update',
      [Query([UiNode, UiClass, ComputedLayout])],
      (chips) => {
        if (typeof window === 'undefined') return;
        const out: { classes: string[]; bg: number[] | null; cx: number; cy: number }[] = [];
        for (const row of chips.entries()) {
          const cls = row[2] as UiClass;
          if (!cls.classes.includes('chip')) continue;
          const style = (row[1] as UiNode).style;
          const layout = row[3] as ComputedLayout;
          const bg = style.backgroundColor;
          out.push({
            classes: cls.classes,
            bg: bg !== undefined ? [bg[0]!, bg[1]!, bg[2]!, bg[3]!] : null,
            cx: Math.round(layout.x + layout.width / 2),
            cy: Math.round(layout.y + layout.height / 2),
          });
        }
        (window as unknown as { __rss: unknown }).__rss = { chips: out };
      },
      { label: 'rss-report' },
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

    // Report each menu button's screen rect to a window probe (for verification).
    app.addSystem(
      'update',
      [Query([ComputedLayout, MenuAction])],
      (menu) => {
        if (typeof window === 'undefined') return;
        const items: { name: string; cx: number; cy: number; disabled: boolean }[] = [];
        for (const row of menu.entries()) {
          const entity = row[0] as Entity;
          const layout = row[1] as ComputedLayout;
          const action = row[2] as MenuAction;
          items.push({
            name: action.name,
            cx: Math.round(layout.x + layout.width / 2),
            cy: Math.round(layout.y + layout.height / 2),
            disabled: app.world.getComponent(entity, Disabled) !== undefined,
          });
        }
        (window as unknown as { __menu: unknown }).__menu = items;
      },
      { label: 'menu-report' },
    );

    // Resolve a click to its MenuAction and update the LAST label + a probe.
    app.addSystem(
      'update',
      [MessageReader(UiClicked), Query([UiText, MenuLast])],
      (clicks, labels) => {
        for (const click of clicks) {
          const action = app.world.getComponent((click as UiClicked).entity, MenuAction);
          if (action === undefined) continue;
          for (const row of labels.entries()) {
            (row[1] as UiText).text = `LAST: ${action.name}`;
          }
          setGameProbe({ lastAction: action.name });
        }
      },
      { label: 'menu-click' },
    );

    // Once the packed credits asset has streamed in from the `.rpak`, reflect it
    // in the label + probe — the end-to-end proof that a GUID-referenced asset
    // loads over HTTP from the exported archive.
    app.addSystem(
      'update',
      [Query([UiText, CreditsLabel])],
      (labels) => {
        if (creditsShown || creditsHandle === undefined) return;
        const value = texts.get(creditsHandle);
        if (value === undefined) return;
        creditsShown = true;
        for (const row of labels.entries()) (row[1] as UiText).text = 'CREDITS: LOADED';
        setGameProbe({ credits: value });
      },
      { label: 'credits-consume' },
    );
  }
}

export default defineProject({
  plugins: [new HelloTextPlugin()],
  meta: { name: 'Retro Engine Sample' },
});
