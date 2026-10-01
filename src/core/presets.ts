import type { Size } from './types';

/**
 * How a preset decides the crop shape and the output size:
 * - document: fixed output pixels; the crop ratio is always derived from them.
 * - ratio:    a fixed aspect ratio; output keeps the crop's own pixel size.
 * - original: the source image's own aspect ratio.
 * - free:     no ratio at all.
 */
export type Preset =
  | (PresetBase & {
      kind: 'document';
      /** Two-letter country / region code shown on the document badge. */
      code: string;
      px: Size;
      mm?: Size;
      maxKB?: number;
      background: string;
      framing: string;
    })
  | (PresetBase & { kind: 'ratio'; rw: number; rh: number })
  | (PresetBase & { kind: 'original' | 'free' });

interface PresetBase {
  id: string;
  label: string;
  group: PresetGroupId;
  hint: string;
  /** Not yet checked against the issuing authority's current spec (audit pending). */
  verified: boolean;
}

export type PresetGroupId = 'documents' | 'ratios';

export const presetGroups: Record<PresetGroupId, string> = {
  documents: 'Passport & visa photos',
  ratios: 'Aspect ratios',
};

type DocInput = Omit<Extract<Preset, { kind: 'document' }>, 'kind' | 'group' | 'verified' | 'code'>;
const doc = (p: DocInput): Preset => ({
  ...p,
  code: (p.id.split('-')[0] ?? p.id).toUpperCase(),
  kind: 'document',
  group: 'documents',
  verified: false,
});
const ratio = (rw: number, rh: number, hint: string, label = `${rw} : ${rh}`): Preset => ({
  id: `ratio-${rw}-${rh}`,
  label,
  kind: 'ratio',
  rw,
  rh,
  group: 'ratios',
  hint,
  verified: true,
});

export const presets: Preset[] = [
  doc({
    id: 'pk-passport',
    label: 'Pakistan - Passport / Visa',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    background: 'White',
    framing: 'Head and shoulders, face covering about 70–80% of the photo. Neutral expression.',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'us-passport',
    label: 'United States - Passport / Visa',
    px: { w: 600, h: 600 },
    mm: { w: 51, h: 51 },
    maxKB: 240,
    background: 'White or off-white',
    framing: 'Head 25–35 mm from chin to top of head (50–69% of the photo). No glasses.',
    hint: '2 × 2 in',
  }),
  doc({
    id: 'uk-passport',
    label: 'United Kingdom - Passport / Visa',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    background: 'Plain cream or light grey',
    framing: 'Head 29–34 mm from chin to crown. Glasses only if there is no glare.',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'eu-schengen',
    label: 'Schengen / EU - Visa / ID',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    background: 'Light grey or white',
    framing: 'Face 32–36 mm (70–80% of the photo).',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'ca-passport',
    label: 'Canada - Passport',
    px: { w: 591, h: 827 },
    mm: { w: 50, h: 70 },
    background: 'Plain white',
    framing: 'Head 31–36 mm from chin to crown.',
    hint: '50 × 70 mm',
  }),
  doc({
    id: 'ca-visa',
    label: 'Canada - Visa',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    maxKB: 240,
    background: 'White or light-coloured',
    framing: 'Head 25–30 mm from chin to crown.',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'au-passport',
    label: 'Australia - Passport / Visa',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    background: 'White or light grey',
    framing: 'Face 32–36 mm from chin to crown. No glasses.',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'cn-visa',
    label: 'China - Visa',
    px: { w: 390, h: 567 },
    mm: { w: 33, h: 48 },
    maxKB: 150,
    background: 'White or near-white',
    framing: 'Head 28–33 mm. Ears visible.',
    hint: '33 × 48 mm',
  }),
  doc({
    id: 'in-passport',
    label: 'India - Passport / e-Visa',
    px: { w: 600, h: 600 },
    background: 'White',
    framing: 'Face covers about 80–85% of the photo.',
    hint: 'Square, 600 × 600 px',
  }),
  doc({
    id: 'jp-passport',
    label: 'Japan - Passport / Visa',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    maxKB: 240,
    background: 'Plain white',
    framing: 'Face 32–36 mm from chin to crown.',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'kr-keta',
    label: 'South Korea - K-ETA / Visa',
    px: { w: 700, h: 700 },
    maxKB: 100,
    background: 'White',
    framing: 'Face fills most of the frame, front view.',
    hint: 'Square, 700 × 700 px',
  }),
  doc({
    id: 'ru-visa',
    label: 'Russia - Visa',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    maxKB: 30,
    background: 'Light or white',
    framing: 'Head covers about 70–75% of the photo.',
    hint: '35 × 45 mm',
  }),
  doc({
    id: 'ae-visa',
    label: 'UAE - Visa / Residency',
    px: { w: 413, h: 531 },
    mm: { w: 35, h: 45 },
    maxKB: 100,
    background: 'Pure white',
    framing: 'Front view, neutral expression.',
    hint: '35 × 45 mm',
  }),

  { id: 'free', label: 'Free crop', kind: 'free', group: 'ratios', hint: 'Any shape', verified: true },
  {
    id: 'original',
    label: 'Original ratio',
    kind: 'original',
    group: 'ratios',
    hint: 'Same shape as your photo',
    verified: true,
  },
  ratio(1, 1, 'Profile pictures, Instagram', 'Square 1 : 1'),
  ratio(4, 5, 'Portrait posts'),
  ratio(3, 4, 'Classic portrait'),
  ratio(2, 3, '35 mm photo prints'),
  ratio(5, 7, '5 × 7 in prints'),
  ratio(9, 16, 'Stories, Reels, Shorts'),
  ratio(16, 9, 'YouTube, widescreen'),
  ratio(4, 3, 'Classic landscape'),
  ratio(3, 2, 'Camera landscape'),
  ratio(5, 4, 'Large-format landscape'),
  ratio(7, 5, 'Landscape prints'),
  ratio(2, 1, 'Banners, panoramas'),
  ratio(1, 2, 'Tall banners'),
];

/** The app opens in free crop. */
export const DEFAULT_PRESET_ID = 'free';
/** The document shown on the document chip and card until the user picks another. */
export const DEFAULT_DOCUMENT_ID = 'pk-passport';

export function getPreset(id: string): Preset {
  const found = presets.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown preset: ${id}`);
  return found;
}

/** Width ÷ height the crop must keep, or null when the crop is unconstrained. */
export function presetRatio(preset: Preset, image: Size | null): number | null {
  switch (preset.kind) {
    case 'document':
      return preset.px.w / preset.px.h;
    case 'ratio':
      return preset.rw / preset.rh;
    case 'original':
      return image ? image.w / image.h : null;
    case 'free':
      return null;
  }
}

/** The pixel size the exported photo will have for a given crop size. */
export function presetOutputSize(preset: Preset, crop: Size): Size {
  if (preset.kind === 'document') return { ...preset.px };
  return { w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)) };
}
