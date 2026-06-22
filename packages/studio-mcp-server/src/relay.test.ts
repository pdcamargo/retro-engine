import { describe, expect, test } from 'bun:test';
import { WebSocket } from 'ws';

import { StudioLink } from './relay';

const HELLO = {
  type: 'hello' as const,
  protocolVersion: 1,
  studio: { name: 'test', version: '0', platform: 'test', projectDir: null },
  commands: [{ name: 'echo', title: 'Echo', description: 'echo', domain: 'test', mutating: false, inputSchema: { type: 'object' as const } }],
};

describe('StudioLink', () => {
  test('rejects invoke when no studio is connected', async () => {
    const link = new StudioLink();
    await expect(link.invoke('echo', {})).rejects.toThrow(/not connected/);
  });

  test('round-trips an invoke to the connected studio', async () => {
    const link = new StudioLink();
    await link.listen(0);
    const client = new WebSocket(`ws://127.0.0.1:${link.port}`);
    await new Promise<void>((resolve) => client.on('open', () => resolve()));

    // Act as the studio: announce a catalog, then answer invokes by echoing args.
    client.on('message', (data: Buffer) => {
      const frame = JSON.parse(data.toString()) as { type: string; id?: string; args?: unknown };
      if (frame.type === 'invoke') {
        client.send(JSON.stringify({ type: 'result', id: frame.id, ok: true, result: { got: frame.args } }));
      }
    });
    client.send(JSON.stringify(HELLO));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(link.connected).toBe(true);
    expect(link.commands).toHaveLength(1);

    const result = await link.invoke('echo', { a: 1 });
    expect(result).toEqual({ got: { a: 1 } });

    client.close();
    link.close();
  });
});
