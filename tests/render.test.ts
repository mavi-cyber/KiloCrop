import { describe, expect, it } from 'vitest';
import { headGuide } from '../src/core/guide';
import { getPreset } from '../src/core/presets';
import { capPixels, orientedSize } from '../src/core/render';

describe('working image', () => {
  it('leaves normal photos alone and caps huge ones, keeping the shape', () => {
    expect(capPixels({ w: 4032, h: 3024 })).toEqual({ w: 4032, h: 3024 });
    const capped = capPixels({ w: 8000, h: 6000 });
    expect(capped.w * capped.h).toBeLessThanOrEqual(16_000_000);
    expect(capped.w / capped.h).toBeCloseTo(8000 / 6000, 2);
  });

  it('swaps width and height on odd quarter turns', () => {
    expect(orientedSize({ w: 400, h: 300 }, 1)).toEqual({ w: 300, h: 400 });
    expect(orientedSize({ w: 400, h: 300 }, 2)).toEqual({ w: 400, h: 300 });
  });
});

describe('head guide', () => {
  it('exists only for document presets, with the crown above the chin', () => {
    expect(headGuide(getPreset('ratio-1-1'))).toBeNull();
    const pk = headGuide(getPreset('pk-passport'));
    const us = headGuide(getPreset('us-passport'));
    expect(pk && pk.crown < pk.chin).toBe(true);
    expect(us && us.chin - us.crown < (pk?.chin ?? 0) - (pk?.crown ?? 0)).toBe(true);
  });
});
