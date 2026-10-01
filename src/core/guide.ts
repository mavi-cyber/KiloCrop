import type { Preset } from './presets';

/**
 * Where the head should sit inside a document photo, as fractions of the photo
 * height. It is an alignment aid drawn over the crop, not a compliance check.
 */
export interface HeadGuide {
  crown: number; // top of the head
  chin: number;
}

export function headGuide(preset: Preset): HeadGuide | null {
  if (preset.kind !== 'document') return null;
  const ratio = preset.px.w / preset.px.h;
  // Square photos (US / India / Korea style) use a smaller head, 50–69% of the height.
  if (ratio > 0.95) return { crown: 0.14, chin: 0.74 };
  // Portrait ICAO-style photos: head roughly 70–80% of the height, small top margin.
  return { crown: 0.09, chin: 0.84 };
}
