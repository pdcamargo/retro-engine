import { type CommandDef, defineCommand } from '../registry';

/** Renderer introspection: backend capabilities and per-system cost. */
export const rendererCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'renderer.capabilities',
    title: 'Renderer capabilities',
    description: 'The active backend feature flags (compute shaders, storage textures, timestamp queries, …).',
    domain: 'renderer',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({ ...ctx.app.renderer.capabilities }),
  }),
  defineCommand({
    name: 'renderer.stats',
    title: 'Renderer stats',
    description: 'Per-stage system counts and rolling frame cost from the live schedule.',
    domain: 'renderer',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => {
      let frameMs = 0;
      let total = 0;
      let enabled = 0;
      const stages = ctx.app.describeSchedule().map((group) => {
        let stageMs = 0;
        for (const sys of group.systems) {
          total += 1;
          if (sys.enabled) enabled += 1;
          stageMs += sys.avgMs ?? 0;
        }
        frameMs += stageMs;
        return { stage: group.stage, systems: group.systems.length, ms: Number(stageMs.toFixed(3)) };
      });
      return { systems: { total, enabled }, frameMs: Number(frameMs.toFixed(3)), stages };
    },
  }),
];
