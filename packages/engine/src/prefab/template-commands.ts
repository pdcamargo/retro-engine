import type { Entity } from '@retro-engine/ecs';

import { Commands, type CommandsHandle } from '../commands';
import { Parent } from '../hierarchy';
import type { App } from '../index';

import { expandTemplate, type ParamSchema, type ResolvedParams, type Template } from './template';
import { resolveParams } from './template-params';
import { TemplateRegistry } from './template-registry';

/** Mint a one-shot command buffer bound to the App, mirroring `spawnScene`. */
const appCommands = (app: App): CommandsHandle =>
  Commands.resolve({
    app,
    world: app.world,
    stage: 'update',
    systemId: app.mintSystemId(),
    lastSeenTick: 0,
    lastSeenFrame: -1,
  }) as CommandsHandle;

const resolveTemplate = (app: App, template: Template<ParamSchema> | string): Template<ParamSchema> => {
  if (typeof template !== 'string') return template;
  const found = app.getResource(TemplateRegistry)?.get(template);
  if (found === undefined) throw new Error(`prefab: no template registered as '${template}'`);
  return found;
};

/** Split produced components into the `Parent` edges (routed via addChild) and the rest. */
const partitionParents = (components: readonly object[]): { parents: Parent[]; rest: object[] } => {
  const parents: Parent[] = [];
  const rest: object[] = [];
  for (const c of components) {
    if (c instanceof Parent) parents.push(c);
    else rest.push(c);
  }
  return { parents, rest };
};

/**
 * Spawn a fresh entity from a template, substituting params (omitted params use
 * their defaults) and resolving Required Components.
 *
 * Like `spawnScene`, this drives the spawn through the command buffer, so engine
 * lifecycle hooks fire and `static requires` fill in. Any `Parent` the template
 * produces is routed through `addChild` so the reciprocal `Children` is wired.
 * Returns the new entity id.
 */
export function spawnTemplate<P extends ParamSchema>(
  app: App,
  template: Template<P>,
  params?: Partial<ResolvedParams<P>>,
): Entity;
export function spawnTemplate(app: App, template: string, params?: Record<string, unknown>): Entity;
export function spawnTemplate(
  app: App,
  template: Template<ParamSchema> | string,
  params: Record<string, unknown> = {},
): Entity {
  const tmpl = resolveTemplate(app, template);
  const resolved = resolveParams(tmpl.params, params);
  const { parents, rest } = partitionParents(expandTemplate(tmpl, resolved));

  const cmd = appCommands(app);
  const entity = cmd.spawn(...rest).id;
  for (const parent of parents) cmd.entity(parent.entity).addChild(entity);
  app.flushCommands();
  return entity;
}

/**
 * Apply a template to an existing entity as a patch: insert the template's
 * components onto it without rebuilding the entity. A component already present is
 * overwritten; a missing one is added; untouched components are left alone.
 *
 * Overrides are one-shot — after this returns the entity is just components, with
 * no link back to the template. Required Components fill in on insert.
 */
export function applyTemplate<P extends ParamSchema>(
  app: App,
  entity: Entity,
  template: Template<P>,
  params?: Partial<ResolvedParams<P>>,
): void;
export function applyTemplate(
  app: App,
  entity: Entity,
  template: string,
  params?: Record<string, unknown>,
): void;
export function applyTemplate(
  app: App,
  entity: Entity,
  template: Template<ParamSchema> | string,
  params: Record<string, unknown> = {},
): void {
  const tmpl = resolveTemplate(app, template);
  const resolved = resolveParams(tmpl.params, params);
  const { parents, rest } = partitionParents(expandTemplate(tmpl, resolved));

  const cmd = appCommands(app);
  if (rest.length > 0) cmd.entity(entity).insert(...rest);
  for (const parent of parents) cmd.entity(parent.entity).addChild(entity);
  app.flushCommands();
}
