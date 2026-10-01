import {
  cursorFor,
  fitInside,
  hitTest,
  initialCrop,
  moveRect,
  resizeFree,
  resizeLocked,
} from '../core/geometry';
import type { HeadGuide } from '../core/guide';
import type { DragTarget, Point, Rect, Size } from '../core/types';

export type CropListener = (crop: Rect, final: boolean) => void;

const MIN_CROP_CSS = 24; // smallest crop, in on-screen pixels
const HIT_MOUSE = 12; // handle grab distance, on-screen pixels
const HIT_TOUCH = 26;
const HISTORY_LIMIT = 100;

interface Drag {
  pointerId: number;
  target: DragTarget;
  startPoint: Point;
  startCrop: Rect;
}

export interface CropperParts {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Floating label above the crop (dimensions). */
  tagTop: HTMLElement;
  /** Floating label under the crop's bottom-right corner (file size). */
  tagBottom: HTMLElement;
}

/**
 * Interactive crop frame. All state is kept in source-image pixels, so screen
 * size, CSS scaling and device pixel ratio never change the result.
 */
export class Cropper {
  private source: CanvasImageSource | null = null;
  private size: Size = { w: 1, h: 1 };
  private ratio: number | null = null;
  private rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private view: Size = { w: 1, h: 1 }; // CSS pixels the canvas is shown at
  private guide: HeadGuide | null = null;
  private drag: Drag | null = null;
  private undoStack: Rect[] = [];
  private redoStack: Rect[] = [];
  private listeners: CropListener[] = [];
  private historyListeners: (() => void)[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  private readonly p: CropperParts;

  constructor(parts: CropperParts) {
    this.p = parts;
    const ctx = parts.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;

    new ResizeObserver(() => this.layout()).observe(parts.stage);
    // Listen on the whole stage so handles at the photo's edge can be grabbed from just outside it.
    parts.stage.addEventListener('pointerdown', this.onDown);
    parts.stage.addEventListener('pointermove', this.onMove);
    parts.stage.addEventListener('pointerup', this.onUp);
    parts.stage.addEventListener('pointercancel', this.onUp);
    parts.canvas.addEventListener('keydown', this.onKey);
  }

  get crop(): Rect {
    return { ...this.rect };
  }

  get hasImage(): boolean {
    return this.source !== null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  onChange(fn: CropListener): void {
    this.listeners.push(fn);
  }

  onHistory(fn: () => void): void {
    this.historyListeners.push(fn);
  }

  /** Shows a new (already oriented) image with a fresh, centred crop. */
  setSource(source: CanvasImageSource, size: Size, ratio: number | null): void {
    this.source = source;
    this.size = size;
    this.ratio = ratio;
    this.layout();
    this.reset();
  }

  /** Changes the locked ratio (null = free) and recentres the crop. */
  setRatio(ratio: number | null): void {
    this.ratio = ratio;
    if (this.source) this.reset();
  }

  setGuide(guide: HeadGuide | null): void {
    this.guide = guide;
    this.draw();
  }

  setTags(top: string, bottom: string, bottomTone: 'ok' | 'warn' | 'plain' = 'plain'): void {
    this.p.tagTop.textContent = top;
    this.p.tagBottom.textContent = bottom;
    this.p.tagBottom.dataset.tone = bottomTone;
    this.placeTags();
  }

  /** Recentres the crop at the default size. */
  reset(): void {
    this.rect = initialCrop(this.size, this.ratio);
    this.undoStack = [];
    this.redoStack = [];
    this.draw();
    this.emit(true);
    this.emitHistory();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.crop);
    this.rect = prev;
    this.draw();
    this.emit(true);
    this.emitHistory();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.crop);
    this.rect = next;
    this.draw();
    this.emit(true);
    this.emitHistory();
  }

  private remember(before: Rect): void {
    const r = this.rect;
    if (before.x === r.x && before.y === r.y && before.w === r.w && before.h === r.h) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  private emit(final: boolean): void {
    const c = this.crop;
    this.listeners.forEach((fn) => fn(c, final));
  }

  private emitHistory(): void {
    this.historyListeners.forEach((fn) => fn());
  }

  /** Fits the canvas inside the stage's padding box, sharp on high-DPI screens. */
  private layout(): void {
    if (!this.source) return;
    const st = getComputedStyle(this.p.stage);
    const boxW = this.p.stage.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const boxH = this.p.stage.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
    this.view = fitInside(this.size, { w: Math.max(80, boxW), h: Math.max(80, boxH) });

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = this.p.canvas;
    c.style.width = `${this.view.w}px`;
    c.style.height = `${this.view.h}px`;
    c.width = Math.round(this.view.w * dpr);
    c.height = Math.round(this.view.h * dpr);
    this.draw();
  }

  /** Image pixels per on-screen CSS pixel. */
  private get imgPerCss(): number {
    return this.size.w / this.view.w;
  }

  private toImage(e: PointerEvent): Point {
    const b = this.p.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - b.left) / b.width) * this.size.w,
      y: ((e.clientY - b.top) / b.height) * this.size.h,
    };
  }

  private targetAt(p: Point, pointerType: string): DragTarget | null {
    const tol = (pointerType === 'touch' ? HIT_TOUCH : HIT_MOUSE) * this.imgPerCss;
    return hitTest(this.rect, p, tol, this.ratio !== null);
  }

  /** Only react to pointers on the stage background or the canvas, not on floating controls. */
  private isStagePointer(e: PointerEvent): boolean {
    return e.target === this.p.stage || e.target === this.p.canvas;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.source || !this.isStagePointer(e)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.toImage(e);
    const target = this.targetAt(p, e.pointerType);
    if (!target) return;
    e.preventDefault();
    this.p.stage.setPointerCapture(e.pointerId);
    this.drag = { pointerId: e.pointerId, target, startPoint: p, startCrop: this.crop };
    this.p.stage.classList.add('is-dragging');
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.source) return;
    const p = this.toImage(e);

    if (!this.drag || this.drag.pointerId !== e.pointerId) {
      if (e.pointerType === 'mouse' && this.isStagePointer(e)) {
        const t = this.targetAt(p, e.pointerType);
        this.p.stage.style.cursor = t ? cursorFor[t] : '';
      }
      return;
    }

    const { target, startPoint, startCrop } = this.drag;
    const dx = p.x - startPoint.x;
    const dy = p.y - startPoint.y;
    const min = MIN_CROP_CSS * this.imgPerCss;

    if (target === 'move') {
      this.rect = moveRect(startCrop, dx, dy, this.size);
    } else if (this.ratio !== null) {
      if (target === 'nw' || target === 'ne' || target === 'se' || target === 'sw') {
        this.rect = resizeLocked(startCrop, target, dx, dy, this.size, this.ratio, min);
      }
    } else {
      this.rect = resizeFree(startCrop, target, dx, dy, this.size, min);
    }
    this.draw();
    this.emit(false);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    const before = this.drag.startCrop;
    this.drag = null;
    this.p.stage.classList.remove('is-dragging');
    this.remember(before);
    this.emit(true);
  };

  /** Arrow keys nudge the crop: 1% of the image, or 10% with Shift. */
  private onKey = (e: KeyboardEvent): void => {
    const step = (e.shiftKey ? 0.1 : 0.01) * Math.max(this.size.w, this.size.h);
    const d: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = d[e.key];
    if (!move) return;
    e.preventDefault();
    const before = this.crop;
    this.rect = moveRect(this.rect, move.x, move.y, this.size);
    this.remember(before);
    this.draw();
    this.emit(true);
  };

  /** Repaints the photo, shade, grid, handles and guide. */
  draw(): void {
    const { ctx, source } = this;
    if (!source) return;
    const c = this.p.canvas;
    const s = c.width / this.size.w; // device px per image px
    const px = this.imgPerCss; // one CSS px, in image units
    const { x, y, w, h } = this.rect;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, this.size.w, this.size.h);

    // Shade everything outside the crop.
    ctx.fillStyle = 'rgba(5, 6, 8, 0.66)';
    ctx.beginPath();
    ctx.rect(0, 0, this.size.w, this.size.h);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');

    // Rule-of-thirds grid.
    ctx.strokeStyle = 'rgba(46, 230, 197, 0.45)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(x + w * f, y);
      ctx.lineTo(x + w * f, y + h);
      ctx.moveTo(x, y + h * f);
      ctx.lineTo(x + w, y + h * f);
    }
    ctx.stroke();

    if (this.guide) this.drawGuide(px);

    // Frame.
    ctx.strokeStyle = '#2ee6c5';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // Corner brackets (always) and edge bars (free mode only).
    const len = Math.min(18 * px, w / 3, h / 3);
    ctx.lineWidth = 3.5 * px;
    ctx.lineCap = 'square';
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    const corners: [number, number, number, number][] = [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x + w, y + h, -1, -1],
      [x, y + h, 1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.moveTo(cx + sx * len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * len);
    }
    if (this.ratio === null) {
      const half = Math.min(10 * px, w / 6, h / 6);
      ctx.moveTo(x + w / 2 - half, y);
      ctx.lineTo(x + w / 2 + half, y);
      ctx.moveTo(x + w / 2 - half, y + h);
      ctx.lineTo(x + w / 2 + half, y + h);
      ctx.moveTo(x, y + h / 2 - half);
      ctx.lineTo(x, y + h / 2 + half);
      ctx.moveTo(x + w, y + h / 2 - half);
      ctx.lineTo(x + w, y + h / 2 + half);
    }
    ctx.stroke();

    this.placeTags();
  }

  private drawGuide(px: number): void {
    const g = this.guide;
    if (!g) return;
    const { ctx } = this;
    const { x, y, w, h } = this.rect;
    const crown = y + g.crown * h;
    const chin = y + g.chin * h;
    const ry = (chin - crown) / 2;
    const rx = Math.min(ry * 0.74, w * 0.42);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 181, 71, 0.95)';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.beginPath();
    ctx.ellipse(x + w / 2, crown + ry, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 181, 71, 0.6)';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(x, crown);
    ctx.lineTo(x + w, crown);
    ctx.moveTo(x, chin);
    ctx.lineTo(x + w, chin);
    ctx.stroke();
    ctx.restore();
  }

  /** Positions the floating labels next to the crop, kept inside the stage. */
  private placeTags(): void {
    const { stage, canvas, tagTop, tagBottom } = this.p;
    if (!this.source) {
      tagTop.hidden = tagBottom.hidden = true;
      return;
    }
    tagTop.hidden = !tagTop.textContent;
    tagBottom.hidden = !tagBottom.textContent;
    const sb = stage.getBoundingClientRect();
    const cb = canvas.getBoundingClientRect();
    const k = cb.width / this.size.w;
    const left = cb.left - sb.left + this.rect.x * k;
    const top = cb.top - sb.top + this.rect.y * k;
    const right = left + this.rect.w * k;
    const bottom = top + this.rect.h * k;
    const gap = 8;
    const clampX = (v: number, el: HTMLElement) => Math.min(Math.max(v, 8), sb.width - el.offsetWidth - 8);
    const clampY = (v: number, el: HTMLElement) => Math.min(Math.max(v, 8), sb.height - el.offsetHeight - 8);

    const topY = top - tagTop.offsetHeight - gap;
    tagTop.style.transform = `translate(${clampX((left + right) / 2 - tagTop.offsetWidth / 2, tagTop)}px, ${clampY(
      topY < 8 ? top + gap : topY,
      tagTop,
    )}px)`;
    tagBottom.style.transform = `translate(${clampX(right - tagBottom.offsetWidth + 10, tagBottom)}px, ${clampY(
      bottom + gap,
      tagBottom,
    )}px)`;
  }
}
