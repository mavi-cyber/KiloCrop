export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle in source-image pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type DragTarget = Handle | 'move';
