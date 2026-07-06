import { describe, expect, it } from 'bun:test';

import { type ExportResult, ExportRegistry, type ExportTarget } from './export-target';

const stubTarget = (name: string): ExportTarget => ({
  name,
  export: (): Promise<ExportResult> => Promise.resolve({ outputs: [`${name}/index.html`] }),
});

describe('ExportRegistry', () => {
  it('registers and resolves targets by name', () => {
    const reg = new ExportRegistry();
    reg.register(stubTarget('web'));
    expect(reg.get('web')?.name).toBe('web');
    expect(reg.get('desktop')).toBeUndefined();
    expect(reg.names).toEqual(['web']);
  });

  it('replaces a target registered under the same name', () => {
    const reg = new ExportRegistry();
    reg.register(stubTarget('web'));
    const replacement = stubTarget('web');
    reg.register(replacement);
    expect(reg.get('web')).toBe(replacement);
    expect(reg.names).toEqual(['web']);
  });
});
