import { describe, expect, it } from 'vitest';
import { hitTest, initialCrop, moveRect, resizeFree, resizeLocked } from '../src/core/geometry';

const bounds = { w: 1000, h: 800 };

describe('initialCrop', () => {
  it('centres an 80% rect of the requested ratio', () => {
    const r = initialCrop(bounds, 1);
    expect(r).toEqual({ x: 180, y: 80, w: 640, h: 640 });
  });
});

describe('moveRect', () => {
  // v1 bug: moving a free crop into the right edge shrank it.
  it('stops at the edges without changing size', () => {
    const r = moveRect({ x: 800, y: 600, w: 150, h: 150 }, 500, 500, bounds);
    expect(r).toEqual({ x: 850, y: 650, w: 150, h: 150 });
    expect(moveRect(r, -5000, -5000, bounds)).toEqual({ x: 0, y: 0, w: 150, h: 150 });
  });
});

describe('resizeFree', () => {
  const start = { x: 100, y: 100, w: 300, h: 200 };

  it('moves only the dragged edges', () => {
    expect(resizeFree(start, 'e', 50, 999, bounds, 20)).toEqual({ x: 100, y: 100, w: 350, h: 200 });
    expect(resizeFree(start, 'nw', -30, -40, bounds, 20)).toEqual({ x: 70, y: 60, w: 330, h: 240 });
  });

  it('respects bounds and minimum size', () => {
    expect(resizeFree(start, 'w', -500, 0, bounds, 20)).toMatchObject({ x: 0, w: 400 });
    expect(resizeFree(start, 'w', 1000, 0, bounds, 20)).toMatchObject({ x: 380, w: 20 });
    expect(resizeFree(start, 'se', 5000, 5000, bounds, 20)).toEqual({ x: 100, y: 100, w: 900, h: 700 });
  });
});

describe('resizeLocked', () => {
  const start = { x: 200, y: 200, w: 300, h: 300 };

  it('keeps the ratio and the opposite corner anchored', () => {
    const r = resizeLocked(start, 'se', 100, 10, bounds, 1, 20);
    expect(r).toEqual({ x: 200, y: 200, w: 400, h: 400 });
    const nw = resizeLocked(start, 'nw', -50, -50, bounds, 1, 20);
    expect(nw.x + nw.w).toBe(500);
    expect(nw.y + nw.h).toBe(500);
  });

  it('never leaves the image', () => {
    const r = resizeLocked(start, 'se', 5000, 5000, bounds, 1, 20);
    expect(r.x + r.w).toBeLessThanOrEqual(bounds.w);
    expect(r.y + r.h).toBeLessThanOrEqual(bounds.h);
    expect(r.w / r.h).toBeCloseTo(1);
  });

  it('works with portrait ratios', () => {
    const ratio = 35 / 45;
    const r = resizeLocked({ x: 0, y: 0, w: 350, h: 450 }, 'se', 1000, 1000, bounds, ratio, 20);
    expect(r.h).toBeCloseTo(800);
    expect(r.w / r.h).toBeCloseTo(ratio);
  });
});

describe('hitTest', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  it('finds corners, edges and the body', () => {
    expect(hitTest(r, { x: 101, y: 99 }, 10, false)).toBe('nw');
    expect(hitTest(r, { x: 200, y: 200 }, 10, false)).toBe('s');
    expect(hitTest(r, { x: 200, y: 150 }, 10, false)).toBe('move');
    expect(hitTest(r, { x: 500, y: 500 }, 10, false)).toBeNull();
  });
  it('ignores edge handles when the ratio is locked', () => {
    expect(hitTest(r, { x: 200, y: 200 }, 10, true)).toBe('move');
  });
});
