import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import {
  type DecodeEnv,
  decodeComponent,
  type EncodeEnv,
  encodeComponent,
  TypeRegistry,
} from '@retro-engine/reflect';

import { UiNode } from './ui-node';
import { uiTextSchema } from './ui-plugin';
import { UiText } from './ui-text';

describe('UiText', () => {
  it('applies defaults', () => {
    const t = new UiText();
    expect(t.text).toBe('');
    expect(t.font).toBeUndefined();
    expect(t.fontSize).toBe(16);
    expect(t.letterSpacing).toBe(0);
    expect(t.lineHeight).toBeUndefined();
  });

  it('takes overrides from its options', () => {
    const t = new UiText({ text: 'hi', fontSize: 32, letterSpacing: 1, lineHeight: 40 });
    expect(t.text).toBe('hi');
    expect(t.fontSize).toBe(32);
    expect(t.letterSpacing).toBe(1);
    expect(t.lineHeight).toBe(40);
  });

  it('requires a UiNode so a bare text entity still lays out', () => {
    expect(UiText.requires).toContain(UiNode);
  });
});

describe('UiText reflection', () => {
  const makeReg = () => {
    const reg = new TypeRegistry();
    const entry = reg.registerComponent(UiText, uiTextSchema, {
      name: 'UiText',
      make: () => new UiText(),
    });
    return { reg, entry };
  };
  const enc = (reg: TypeRegistry): EncodeEnv => ({
    registry: reg,
    entityId: (e) => e as unknown as number,
    handleRef: () => undefined,
  });
  const dec = (reg: TypeRegistry): DecodeEnv => ({
    registry: reg,
    entity: (id) => id as unknown as Entity,
    resolveHandle: () => {
      throw new Error('this round-trip has no font handle');
    },
  });

  it('round-trips authored text fields (font unset → omitted, restored undefined)', () => {
    const { reg, entry } = makeReg();
    const text = new UiText({ text: 'Score: 42', fontSize: 28, letterSpacing: 1.5, lineHeight: 30 });

    const back = decodeComponent(entry, encodeComponent(entry, text, enc(reg)), dec(reg)) as UiText;

    expect(back).toBeInstanceOf(UiText);
    expect(back.text).toBe('Score: 42');
    expect(back.fontSize).toBe(28);
    expect(back.letterSpacing).toBe(1.5);
    expect(back.lineHeight).toBe(30);
    expect(back.font).toBeUndefined();
  });

  it('registers under the stable name "UiText"', () => {
    const { reg } = makeReg();
    expect(reg.get('UiText')?.ctor).toBe(UiText);
  });
});
