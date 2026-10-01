import type { DragTarget, Handle, Point, Rect, Size } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Largest rect of the given ratio covering `coverage` of the image, centred. */
export function initialCrop(image: Size, ratio: number | null, coverage = 0.8): Rect {
  const r = ratio ?? image.w / image.h;
  let w: number;
  let h: number;
  if (image.w / image.h > r) {
    h = image.h * coverage;
    w = h * r;
  } else {
    w = image.w * coverage;
    h = w / r;
  }
  return { x: (image.w - w) / 2, y: (image.h - h) / 2, w, h };
}

/** Moves a rect by (dx, dy) without ever changing its size. */
export function moveRect(start: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, bounds.w - start.w),
    y: clamp(start.y + dy, 0, bounds.h - start.h),
  };
}

/** Free resize: each dragged edge moves independently, stays inside bounds and keeps `min` size. */
export function resizeFree(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: Size,
  min: number,
): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, bounds.w);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, bounds.h);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Ratio-locked resize from a corner: the opposite corner stays anchored and the
 * rect follows whichever axis the pointer has pulled further.
 */
export function resizeLocked(
  start: Rect,
  handle: 'nw' | 'ne' | 'se' | 'sw',
  dx: number,
  dy: number,
  bounds: Size,
  ratio: number,
  min: number,
): Rect {
  const east = handle.includes('e');
  const south = handle.includes('s');
  const anchorX = east ? start.x : start.x + start.w;
  const anchorY = south ? start.y : start.y + start.h;

  const wantW = start.w + (east ? dx : -dx);
  const wantH = start.h + (south ? dy : -dy);
  let w = Math.max(wantW, wantH * ratio);

  const maxW = east ? bounds.w - anchorX : anchorX;
  const maxH = south ? bounds.h - anchorY : anchorY;
  const minW = Math.max(min, min * ratio);
  w = clamp(w, Math.min(minW, maxW, maxH * ratio), Math.min(maxW, maxH * ratio));
  const h = w / ratio;

  return { x: east ? anchorX : anchorX - w, y: south ? anchorY : anchorY - h, w, h };
}

/** Which part of the crop rect sits under point `p` (tolerance in the same units). */
export function hitTest(r: Rect, p: Point, tol: number, locked: boolean): DragTarget | null {
  const nearL = Math.abs(p.x - r.x) <= tol;
  const nearR = Math.abs(p.x - (r.x + r.w)) <= tol;
  const nearT = Math.abs(p.y - r.y) <= tol;
  const nearB = Math.abs(p.y - (r.y + r.h)) <= tol;
  const inX = p.x > r.x - tol && p.x < r.x + r.w + tol;
  const inY = p.y > r.y - tol && p.y < r.y + r.h + tol;

  if (nearT && nearL) return 'nw';
  if (nearT && nearR) return 'ne';
  if (nearB && nearR) return 'se';
  if (nearB && nearL) return 'sw';
  if (!locked) {
    if (nearT && inX) return 'n';
    if (nearB && inX) return 's';
    if (nearL && inY) return 'w';
    if (nearR && inY) return 'e';
  }
  if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return 'move';
  return null;
}

export const cursorFor: Record<DragTarget, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move',
};

/** Fits `content` inside `box`, never upscaling past 1:1 unless `allowUpscale`. */
export function fitInside(content: Size, box: Size, allowUpscale = true): Size {
  let s = Math.min(box.w / content.w, box.h / content.h);
  if (!allowUpscale) s = Math.min(s, 1);
  return { w: content.w * s, h: content.h * s };
}
