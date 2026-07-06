import type { Entity, Query as QueryHandle, World } from '@retro-engine/ecs';
import type { App } from '@retro-engine/engine';
import { type Schema, t } from '@retro-engine/reflect';

import { Disabled } from './interaction/ui-button';
import { UiInteraction } from './interaction/ui-interaction';
import { parseRss, type RssRule } from './rss-parser';
import { resolveUiStyle, type StyleNode } from './rss-resolve';
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
 * The live pseudo-class states of a node, derived from its runtime components:
 * `hovered`/`pressed` from {@link UiInteraction} (a pressed node is also hovered,
 * as in CSS `:hover` + `:active`) and `disabled` from the {@link Disabled} marker.
 */
const deriveStates = (world: World, entity: Entity): string[] => {
  const states: string[] = [];
  const interaction = world.getComponent(entity, UiInteraction);
  if (interaction !== undefined) {
    if (interaction.state === 'hovered' || interaction.state === 'pressed') states.push('hovered');
    if (interaction.state === 'pressed') states.push('pressed');
  }
  if (world.getComponent(entity, Disabled) !== undefined) states.push('disabled');
  return states;
};

type UiClassQuery = QueryHandle<readonly [typeof UiNode, typeof UiClass]>;

/**
 * Resolve and apply the active stylesheet to every {@link UiClass} node: build
 * each node's {@link StyleNode} identity (type / name / classes + live states),
 * cascade the sheet's rules onto it, and write the resulting style into the
 * node's {@link UiNode}. Runs every frame (before layout) so pseudo-class state
 * changes — hover, press, disable — reflow immediately.
 */
export const resolveUiStyles = (world: World, nodes: UiClassQuery, sheet: UiStyleSheet): void => {
  for (const row of nodes.entries()) {
    const entity = row[0] as Entity;
    const node = row[1] as UiNode;
    const cls = row[2] as UiClass;
    const styleNode: StyleNode = {
      classes: cls.classes,
      states: deriveStates(world, entity),
      ...(cls.type !== '' ? { type: cls.type } : {}),
      ...(cls.name !== '' ? { name: cls.name } : {}),
    };
    node.style = resolveUiStyle(sheet.rules, styleNode);
  }
};
