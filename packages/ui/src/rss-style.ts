import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import { type App, Children, Parent } from '@retro-engine/engine';
import { type Schema, t } from '@retro-engine/reflect';

import { Disabled } from './interaction/ui-button';
import { UiInteraction } from './interaction/ui-interaction';
import { UiToggle } from './interaction/ui-toggle';
import { parseRss, type RssRule } from './rss-parser';
import { collectGlobalVars, resolveNodeVars, resolveUiStyle, type StyleNode } from './rss-resolve';
import { UiNode } from './ui-node';

/**
 * The active `.rss` stylesheet: the parsed rules the style-resolution system
 * cascades onto every {@link UiClass} node each layout pass. Inserted (empty)
 * by {@link import('./ui-plugin').UiPlugin}; set it from `.rss` source with
 * {@link setUiStyleSheet}.
 *
 * Runtime configuration (the rules originate from a `.rss` asset or source
 * string, not authored per-scene), so it is not reflection-registered.
 */
export class UiStyleSheet {
  constructor(public rules: RssRule[] = []) {}
}

/**
 * A UI node's `.rss` selector identity: its element `type`, `#name`, and
 * `.class` list. The resolution system matches the active {@link UiStyleSheet}
 * against this (plus the node's live pseudo-class states) and writes the winning
 * {@link import('./ui-style').UiStyle} into the node's {@link UiNode}.
 *
 * Authored — a node opts into stylesheet control by carrying one. Empty `type` /
 * `name` mean "no type / name selector applies".
 */
export class UiClass {
  /** CSS-style class names this node carries (matched by `.class` selectors). */
  classes: string[];
  /** The node's `#name` identity (empty = none). */
  name: string;
  /** The node's element type (matched by a bare type selector; empty = none). */
  type: string;

  constructor(init: { classes?: string[]; name?: string; type?: string } = {}) {
    this.classes = init.classes ?? [];
    this.name = init.name ?? '';
    this.type = init.type ?? '';
  }
}

/** Reflection schema for {@link UiClass}: all three selector fields persist. */
export const uiClassSchema: Schema<UiClass> = {
  classes: t.array(t.string),
  name: t.string,
  type: t.string,
};

/**
 * Overrides for `.rss` custom properties (`--name`), merged on top of the ones
 * declared in the active {@link UiStyleSheet}. Setting a var here re-themes every
 * `var(--name)` usage at runtime (e.g. flip an accent color from game code).
 * Runtime configuration, so it is not reflection-registered.
 */
export class UiTheme {
  constructor(public vars: Record<string, string> = {}) {}
}

/**
 * Parse `rss` source and make it the active {@link UiStyleSheet}, replacing any
 * rules already set. Inserts the resource if the {@link import('./ui-plugin').UiPlugin}
 * has not (e.g. called before `build`).
 */
export const setUiStyleSheet = (app: App, rss: string): void => {
  const rules = parseRss(rss);
  const sheet = app.getResource(UiStyleSheet);
  if (sheet !== undefined) sheet.rules = rules;
  else app.insertResource(new UiStyleSheet(rules));
};

/**
 * Merge `vars` into the {@link UiTheme} resource (creating it if needed), so
 * `var(--name)` references re-resolve to the new values on the next layout pass.
 */
export const setUiThemeVars = (app: App, vars: Record<string, string>): void => {
  const theme = app.getResource(UiTheme);
  if (theme !== undefined) theme.vars = { ...theme.vars, ...vars };
  else app.insertResource(new UiTheme({ ...vars }));
};

/**
 * The live pseudo-class states of a node, derived from its runtime components +
 * the current focus: `hovered`/`pressed` from {@link UiInteraction} (a pressed
 * node is also hovered, as in CSS `:hover` + `:active`), `disabled` from the
 * {@link Disabled} marker, `checked` from a {@link UiToggle}'s state, and
 * `focused` when the node is `focusedEntity`.
 */
const deriveStates = (world: World, entity: Entity, focusedEntity: Entity | null): string[] => {
  const states: string[] = [];
  const interaction = world.getComponent(entity, UiInteraction);
  if (interaction !== undefined) {
    if (interaction.state === 'hovered' || interaction.state === 'pressed') states.push('hovered');
    if (interaction.state === 'pressed') states.push('pressed');
  }
  if (world.getComponent(entity, Disabled) !== undefined) states.push('disabled');
  if (world.getComponent(entity, UiToggle)?.checked === true) states.push('checked');
  if (focusedEntity !== null && entity === focusedEntity) states.push('focused');
  return states;
};

/** Build a node's `.rss` matching identity from its {@link UiClass} + live states. */
const buildStyleNode = (
  world: World,
  entity: Entity,
  cls: UiClass,
  focusedEntity: Entity | null,
): StyleNode => ({
  classes: cls.classes,
  states: deriveStates(world, entity, focusedEntity),
  ...(cls.type !== '' ? { type: cls.type } : {}),
  ...(cls.name !== '' ? { name: cls.name } : {}),
});

type UiNodeQuery = QueryHandle<readonly [typeof UiNode]>;

/**
 * Resolve and apply the active stylesheet to every {@link UiClass} node, walking
 * the UI hierarchy so custom properties **inherit**: each node starts from the
 * global (`*` / `:root`) variables plus any its ancestors declared, and a
 * matching element selector's `--vars` override those within its subtree. A node
 * without a {@link UiClass} keeps its authored style but still passes inherited
 * vars to its children. The `UiTheme` resource overrides all vars at resolve time
 * (runtime re-theming). Runs every frame (before layout) so pseudo-class state
 * changes — hover, press, disable — reflow immediately.
 */
export const resolveUiStyles = (
  world: World,
  nodes: UiNodeQuery,
  sheet: UiStyleSheet,
  theme?: UiTheme,
  focusedEntity: Entity | null = null,
): void => {
  const uiSet = new Set<Entity>();
  for (const row of nodes.entries()) uiSet.add(row[0] as Entity);
  if (uiSet.size === 0) return;

  const rules = sheet.rules;
  // The theme resource acts like a runtime `:root` override: it seeds the global
  // base, and a matching ancestor's element-scoped `--vars` still override it
  // within their subtree (so scoped vars survive re-theming).
  const base = theme?.vars !== undefined ? { ...collectGlobalVars(rules), ...theme.vars } : collectGlobalVars(rules);

  const walk = (entity: Entity, inherited: Record<string, string>): void => {
    let merged = inherited;
    const cls = world.getComponent(entity, UiClass);
    if (cls !== undefined) {
      const styleNode = buildStyleNode(world, entity, cls, focusedEntity);
      const own = resolveNodeVars(rules, styleNode);
      if (Object.keys(own).length > 0) merged = { ...inherited, ...own };
      const node = world.getComponent(entity, UiNode);
      if (node !== undefined) node.style = resolveUiStyle(rules, styleNode, undefined, merged);
    }
    const children = world.getComponent(entity, Children);
    if (children !== undefined) {
      for (const child of children.entities) if (uiSet.has(child)) walk(child, merged);
    }
  };

  for (const entity of uiSet) {
    const parent = world.getComponent(entity, Parent);
    if (parent !== undefined && uiSet.has(parent.entity)) continue; // laid out by its parent's walk
    walk(entity, base);
  }
};
