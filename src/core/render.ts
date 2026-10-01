import type { Rect, Size } from './types';

export type OutputFormat = 'jpeg' | 'png' | 'webp';

export const formatInfo: Record<OutputFormat, { mime: string; ext: string; label: string; lossy: boolean }> =
  {
    jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', lossy: true },
    png: { mime: 'image/png', ext: 'png', label: 'PNG', lossy: false },
    webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true },
  };

/** iOS Safari refuses canvases above ~16.7 megapixels; stay safely under it. */
export const MAX_WORKING_PIXELS = 16_000_000;

/** Size that keeps the image's shape but fits under `maxPixels`. */
export function capPixels(size: Size, maxPixels = MAX_WORKING_PIXELS): Size {
  const px = size.w * size.h;
  if (px <= maxPixels) return { ...size };
  const s = Math.sqrt(maxPixels / px);
  return { w: Math.floor(size.w * s), h: Math.floor(size.h * s) };
}

export interface Orientation {
  /** Clockwise quarter turns, 0–3. */
  turns: number;
  flipX: boolean;
}

/** Size after applying `turns` quarter rotations. */
export function orientedSize(size: Size, turns: number): Size {
  return turns % 2 === 0 ? { ...size } : { w: size.h, h: size.w };
}

/**
 * Bakes rotation, mirroring and the pixel cap into a canvas that the cropper and
 * the exporter both read from, so every later step works on plain upright pixels.
 */
export function buildWorkingCanvas(
  source: CanvasImageSource,
  natural: Size,
  o: Orientation,
): HTMLCanvasElement {
  const base = capPixels(natural);
  const out = orientedSize(base, o.turns);
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(out.w / 2, out.h / 2);
  ctx.rotate((o.turns * Math.PI) / 2);
  if (o.flipX) ctx.scale(-1, 1);
  ctx.drawImage(source, -base.w / 2, -base.h / 2, base.w, base.h);
  return canvas;
}

/**
 * Draws `crop` of the source onto `canvas` at `out` size. The background is
 * filled first so transparent PNGs never turn into black JPEG pixels.
 */
export function renderCrop(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  crop: Rect,
  out: Size,
  background: string | null = '#ffffff',
): void {
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.w, out.h);
  } else {
    ctx.clearRect(0, 0, out.w, out.h);
  }
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, out.w, out.h);
}

export function encode(canvas: HTMLCanvasElement, format: OutputFormat, quality = 0.92): Promise<Blob> {
  const { mime, lossy } = formatInfo[format];
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Could not encode ${mime}`))),
      mime,
      lossy ? quality : undefined,
    );
  });
}
