import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_PRESET_ID,
  getPreset,
  presetOutputSize,
  presetRatio,
  presets,
} from '../src/core/presets';

describe('presets', () => {
  it('have unique ids and the default exists', () => {
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => getPreset(DEFAULT_PRESET_ID)).not.toThrow();
    expect(getPreset(DEFAULT_DOCUMENT_ID).kind).toBe('document');
  });

  // v1 stretched Schengen and Canada-passport photos because pixel and mm ratios disagreed.
  it.each(presets.filter((p) => p.kind === 'document' && p.mm))(
    '$label: pixel ratio matches mm ratio',
    (p) => {
      if (p.kind !== 'document' || !p.mm) return;
      const pxRatio = p.px.w / p.px.h;
      const mmRatio = p.mm.w / p.mm.h;
      expect(Math.abs(pxRatio - mmRatio) / mmRatio).toBeLessThan(0.005);
    },
  );

  it('document output is the fixed pixel size; ratio output keeps crop pixels', () => {
    expect(presetOutputSize(getPreset('us-passport'), { w: 1234, h: 1234 })).toEqual({ w: 600, h: 600 });
    expect(presetOutputSize(getPreset('ratio-16-9'), { w: 1600.4, h: 900.2 })).toEqual({ w: 1600, h: 900 });
  });

  it('original ratio follows the image, free has none', () => {
    expect(presetRatio(getPreset('original'), { w: 4000, h: 3000 })).toBeCloseTo(4 / 3);
    expect(presetRatio(getPreset('free'), { w: 4000, h: 3000 })).toBeNull();
  });
});
