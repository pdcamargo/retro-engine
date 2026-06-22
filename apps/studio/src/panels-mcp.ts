import { type EditorContext, getActivePalette, type PanelDef, type Rgba } from '@retro-engine/editor-sdk';

import { MCP_SETUP_COMMAND, type StudioMcp } from './mcp';

const rgba = (c: readonly [number, number, number], a = 1): Rgba => [c[0] / 255, c[1] / 255, c[2] / 255, a];

/**
 * The MCP panel — the user-facing control surface for AI editor control: enable
 * the bridge, point it at a relay port, allow/deny eval, set up the AI client,
 * install the usage skill, and watch recent AI actions.
 */
export const mcpPanel = (mcp: StudioMcp, pushConsole: (text: string, meta?: string) => void): PanelDef => ({
  id: '/mcp',
  title: 'MCP',
  icon: 'cpu',
  slot: 'bottom',
  flush: true,
  render: ({ ui, widgets }: EditorContext): void => {
    ui.child('mcp-body', { size: [0, 0], border: false, padding: [10, 8] }, () => {
      const p = getActivePalette();
      const connected = mcp.connected();
      const enabled = mcp.enabled();
      widgets.badge(connected ? 'CONNECTED' : enabled ? 'WAITING' : 'OFF', {
        tone: connected ? 'success' : enabled ? 'warning' : 'neutral',
        dot: true,
      });
      ui.sameLine();
      ui.textDisabled(`ws://127.0.0.1:${mcp.port()}`);
      if (!mcp.isAttached()) {
        ui.sameLine();
        ui.textDisabled('· starting…');
      }
      const err = mcp.lastError();
      if (err !== null && !connected && enabled) ui.textColored(rgba(p.amber400), err);
      ui.separator();

      const wantEnabled = ui.checkbox('Enable bridge', enabled);
      if (wantEnabled !== enabled) mcp.setEnabled(wantEnabled);
      ui.textDisabled('When on, the studio serves commands to a relay your AI client launches.');

      const wantEval = ui.checkbox('Allow eval (runs arbitrary code)', mcp.evalEnabled());
      if (wantEval !== mcp.evalEnabled()) mcp.setEvalAllowed(wantEval);

      ui.separator();

      // One-time client setup: the relay registers itself with Claude Code at user
      // scope. The studio can't write ~/.claude.json (sandboxed), so it hands over
      // the command to run from the engine repo.
      ui.textDisabled('Set up Claude Code (run once, from the engine repo):');
      ui.text(MCP_SETUP_COMMAND);
      if (widgets.button('Copy setup command', { variant: 'primary', size: 'sm', icon: 'copy' })) {
        const clip = globalThis.navigator?.clipboard;
        if (clip !== undefined) void clip.writeText(MCP_SETUP_COMMAND);
        pushConsole('Copied MCP setup command — run it once from the engine repo');
      }
      ui.sameLine();
      if (widgets.button('Install SKILL.md', { variant: 'secondary', size: 'sm', icon: 'file-code' })) {
        void mcp.installSkill().then((path) => {
          pushConsole(path !== null ? `Installed MCP skill → ${path}` : 'Could not install skill — no project open');
        });
      }

      ui.separator();
      ui.textDisabled('Recent AI actions');
      const audit = mcp.recentAudit();
      if (audit.length === 0) {
        ui.textDisabled('Nothing yet.');
        return;
      }
      for (const [i, entry] of audit.entries()) {
        ui.withId(`audit-${i}`, () => {
          ui.textColored(rgba(p.textFaint), entry.time);
          ui.sameLine(72);
          ui.textColored(entry.ok ? rgba(p.green400) : rgba(p.red400), entry.command);
        });
      }
    });
  },
});
