import { initChrome } from './chrome';
import { defaultBaseName, formatBytes, splitBytes, toFilename } from './core/format';
import { headGuide } from './core/guide';
import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_PRESET_ID,
  getPreset,
  presetOutputSize,
  presetRatio,
  presets,
  type Preset,
} from './core/presets';
import {
  buildWorkingCanvas,
  encode,
  formatInfo,
  renderCrop,
  type Orientation,
  type OutputFormat,
} from './core/render';
import type { Rect, Size } from './core/types';
import {
  buildExif,
  findExif,
  insertExifJpeg,
  insertExifPng,
  parseExif,
  summarize,
  type MetaSummary,
  type PhotoMeta,
} from './core/metadata';
import { Cropper } from './ui/cropper';
import { icons } from './ui/icons';

type DocPreset = Extract<Preset, { kind: 'document' }>;
type Tab = 'crop' | 'size';

const QUALITY = 0.92;

initChrome();

/* ---------- DOM ---------- */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const app = document.body;
const ui = {
  fileChip: $('file-chip'),
  newPhoto: $<HTMLButtonElement>('new-photo'),
  exportBtn: $<HTMLButtonElement>('export'),
  stage: $('stage'),
  empty: $('empty'),
  choose: $<HTMLButtonElement>('choose'),
  canvas: $<HTMLCanvasElement>('crop-canvas'),
  dock: $('dock'),
  undo: $<HTMLButtonElement>('undo'),
  redo: $<HTMLButtonElement>('redo'),
  rotLeft: $<HTMLButtonElement>('rot-left'),
  rotRight: $<HTMLButtonElement>('rot-right'),
  flip: $<HTMLButtonElement>('flip'),
  guide: $<HTMLButtonElement>('guide'),
  reset: $<HTMLButtonElement>('reset'),
  toast: $('toast'),
  allDocs: $<HTMLButtonElement>('all-docs'),
  docCard: $<HTMLButtonElement>('doc-card'),
  docCode: $('doc-code'),
  docTitle: $('doc-title'),
  docSub: $('doc-sub'),
  spec: $('spec'),
  ratios: $('ratios'),
  kbValue: $('kb-value'),
  kbUnit: $('kb-unit'),
  kbFlag: $('kb-flag'),
  kbBar: $('kb-bar'),
  kbQuality: $('kb-quality'),
  kbLimit: $('kb-limit'),
  outW: $('out-w'),
  outH: $('out-h'),
  ratioLock: $('ratio-lock'),
  formats: $('formats'),
  filename: $<HTMLInputElement>('filename'),
  exportDialog: $<HTMLDialogElement>('export-dialog'),
  exportForm: $<HTMLFormElement>('export-form'),
  exportPreview: $<HTMLCanvasElement>('export-preview'),
  expDims: $('exp-dims'),
  expBytes: $('exp-bytes'),
  expFlag: $('exp-flag'),
  formatHint: $('format-hint'),
  resultCanvas: $<HTMLCanvasElement>('result-canvas'),
  resultDims: $('result-dims'),
  metaGroup: $('meta-group'),
  keepGps: $<HTMLInputElement>('keep-gps'),
  keepCam: $<HTMLInputElement>('keep-cam'),
  metaGpsNote: $('meta-gps-note'),
  metaCamNote: $('meta-cam-note'),
  metaHint: $('meta-hint'),
  metaStatus: $('meta-status'),
  metaInfo: $<HTMLButtonElement>('meta-info'),
  metaHelp: $<HTMLDialogElement>('meta-help'),
  ext: $('ext'),
  docs: $<HTMLDialogElement>('docs'),
  docsSearch: $<HTMLInputElement>('docs-search'),
  docsList: $('docs-list'),
  fileInput: $<HTMLInputElement>('file-input'),
  inspector: $('inspector'),
};

/* ---------- State ---------- */

const documents = presets.filter((p): p is DocPreset => p.kind === 'document');
const ratioPresets = presets.filter((p) => p.kind !== 'document');

const state = {
  image: null as HTMLImageElement | null,
  imageUrl: '',
  fileName: '',
  fileBytes: 0,
  natural: { w: 0, h: 0 } as Size,
  orientation: { turns: 0, flipX: false } as Orientation,
  working: null as HTMLCanvasElement | null,
  size: { w: 0, h: 0 } as Size,
  preset: getPreset(DEFAULT_PRESET_ID),
  lastDoc: getPreset(DEFAULT_DOCUMENT_ID) as DocPreset,
  guideOn: true,
  format: 'jpeg' as OutputFormat,
  lastBytes: 0,
  lastTone: 'plain' as 'ok' | 'warn' | 'plain',
  /** Location / camera details read from the original file (never uploaded anywhere). */
  meta: null as PhotoMeta | null,
  metaSummary: { location: null, camera: null } as MetaSummary,
  keep: { location: false, camera: false },
  sizeJob: 0,
};

const cropper = new Cropper({
  stage: ui.stage,
  canvas: ui.canvas,
  tagTop: $('tag-top'),
  tagBottom: $('tag-bottom'),
});

/* ---------- Toast ---------- */

let toastTimer = 0;
function toast(tone: 'ok' | 'error', text: string): void {
  ui.toast.dataset.tone = tone;
  ui.toast.innerHTML = tone === 'ok' ? icons.check : icons.alert;
  const span = document.createElement('span');
  span.textContent = text;
  ui.toast.append(span);
  ui.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove('is-on'), tone === 'error' ? 6000 : 3500);
}

/* ---------- Helpers ---------- */

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function docRatioLabel(p: DocPreset): string {
  if (p.mm) return `${p.mm.w}:${p.mm.h}`;
  const g = gcd(p.px.w, p.px.h);
  return `${p.px.w / g}:${p.px.h / g}`;
}

function docSizeLabel(p: DocPreset): string {
  return p.mm ? `${p.mm.w} × ${p.mm.h} mm` : `${p.px.w} × ${p.px.h} px`;
}

/** A small rectangle of the given ratio, fitted inside a 14 px box. */
function shapeEl(ratio: number | null, free = false): HTMLElement {
  const el = document.createElement('span');
  el.className = free ? 'shape free' : 'shape';
  const r = ratio ?? 1;
  const box = 14;
  el.style.width = `${Math.round(r >= 1 ? box : box * r)}px`;
  el.style.height = `${Math.round(r >= 1 ? box / r : box)}px`;
  return el;
}

/* ---------- Inspector: document ---------- */

function renderDocument(): void {
  const p = state.preset;
  const isDoc = p.kind === 'document';
  ui.docCard.classList.toggle('is-off', !isDoc);
  if (isDoc) {
    ui.docCode.textContent = p.code;
    ui.docTitle.textContent = p.label;
    ui.docSub.textContent = `${docSizeLabel(p)} · ${p.background.toLowerCase()} background`;
  } else {
    ui.docCode.textContent = '-';
    ui.docTitle.textContent = 'No document';
    ui.docSub.textContent = 'Pick a passport or visa standard';
  }

  ui.spec.hidden = !isDoc;
  if (isDoc) {
    const rows: [string, string][] = [
      ['Output', `${p.px.w} × ${p.px.h} px`],
      ['Framing', p.framing],
    ];
    if (p.maxKB) rows.push(['Max size', `${p.maxKB} KB`]);
    ui.spec.replaceChildren(
      ...rows.map(([k, v]) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = k;
        dd.textContent = v;
        row.append(dt, dd);
        return row;
      }),
    );
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Rules change - double-check the official requirements before you submit.';
    ui.spec.append(note);
  }
}

/* ---------- Inspector: ratio tiles ---------- */

function renderRatios(): void {
  const tiles: HTMLButtonElement[] = [];
  const tile = (id: string, label: string, shape: HTMLElement, title: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ratio';
    b.dataset.preset = id;
    b.title = title;
    b.setAttribute('aria-pressed', String(state.preset.id === id));
    const text = document.createElement('span');
    text.textContent = label;
    b.append(shape, text);
    tiles.push(b);
  };

  // Free first, then the current document's shape, then the plain ratios.
  tile('free', 'Free', shapeEl(1, true), 'Free crop - any shape');
  const d = state.lastDoc;
  tile(d.id, docRatioLabel(d), shapeEl(d.px.w / d.px.h), `${d.label} (${docSizeLabel(d)})`);
  for (const p of ratioPresets) {
    if (p.kind === 'original')
      tile(p.id, 'Orig', shapeEl(state.size.w ? state.size.w / state.size.h : 4 / 3), 'Original ratio');
    else if (p.kind === 'ratio')
      tile(p.id, `${p.rw}:${p.rh}`, shapeEl(p.rw / p.rh), `${p.label} - ${p.hint}`);
  }
  const focused = (document.activeElement as HTMLElement | null)?.dataset.preset;
  ui.ratios.replaceChildren(...tiles);
  if (focused) tiles.find((t) => t.dataset.preset === focused)?.focus({ preventScroll: true });
}

ui.ratios.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]');
  if (b?.dataset.preset) applyPreset(getPreset(b.dataset.preset));
});

/* ---------- Applying a preset ---------- */

function guideFor(p: Preset) {
  return state.guideOn ? headGuide(p) : null;
}

function applyPreset(p: Preset): void {
  state.preset = p;
  if (p.kind === 'document') state.lastDoc = p;
  renderDocument();
  renderRatios();
  ui.ratioLock.classList.toggle('is-on', p.kind !== 'free');
  ui.ratioLock.innerHTML = p.kind === 'free' ? icons.unlock : icons.lock;
  ui.ratioLock.title = p.kind === 'free' ? 'Free shape' : 'Ratio locked';
  ui.guide.disabled = p.kind !== 'document';
  cropper.setGuide(guideFor(p));
  cropper.setRatio(presetRatio(p, state.size));
  if (!state.image) updateMeterEmpty();
}

/* ---------- Document picker ---------- */

function renderDocList(query: string): void {
  const q = query.trim().toLowerCase();
  const items = documents.filter((p) => `${p.label} ${p.code} ${p.hint}`.toLowerCase().includes(q));
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'docs-empty';
    empty.textContent = 'No matching document yet.';
    ui.docsList.replaceChildren(empty);
    return;
  }
  ui.docsList.replaceChildren(
    ...items.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doc-item';
      b.dataset.preset = p.id;
      if (p.id === state.preset.id) b.setAttribute('aria-current', 'true');
      b.innerHTML = `<span class="code"></span><span class="doc-text"><b></b><small></small></span>`;
      const [code, title, sub] = [b.querySelector('.code'), b.querySelector('b'), b.querySelector('small')];
      if (code) code.textContent = p.code;
      if (title) title.textContent = p.label;
      if (sub) sub.textContent = p.mm ? `${docSizeLabel(p)} · ${p.px.w} × ${p.px.h} px` : docSizeLabel(p);
      if (p.maxKB) {
        const kb = document.createElement('span');
        kb.className = 'kb';
        kb.textContent = `≤ ${p.maxKB} KB`;
        b.append(kb);
      }
      return b;
    }),
  );
}

function openDocs(): void {
  ui.docsSearch.value = '';
  renderDocList('');
  ui.docs.showModal();
  if (matchMedia('(pointer: fine)').matches) ui.docsSearch.focus();
}

ui.allDocs.textContent = `All ${documents.length} ›`;
ui.allDocs.addEventListener('click', openDocs);
ui.docCard.addEventListener('click', openDocs);
ui.docsSearch.addEventListener('input', () => renderDocList(ui.docsSearch.value));
ui.docsSearch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  ui.docsList.querySelector<HTMLButtonElement>('button[data-preset]')?.click();
});
ui.docsList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]');
  if (!b?.dataset.preset) return;
  applyPreset(getPreset(b.dataset.preset));
  ui.docs.close();
});
ui.docs.addEventListener('click', (e) => {
  if (e.target === ui.docs) ui.docs.close(); // click on the backdrop
});

/* ---------- Size meter & output ---------- */

function outputSize(crop: Rect): Size {
  return presetOutputSize(state.preset, crop);
}

function updateMeterEmpty(): void {
  ui.kbValue.textContent = '-';
  ui.kbUnit.textContent = '';
  ui.kbFlag.hidden = true;
  ui.kbBar.style.width = '0';
  const p = state.preset;
  ui.kbQuality.textContent = formatInfo[state.format].lossy
    ? `${formatInfo[state.format].label} · ${Math.round(QUALITY * 100)}%`
    : 'lossless';
  ui.kbLimit.textContent = p.kind === 'document' && p.maxKB ? `max ${p.maxKB} KB` : '';
  ui.outW.textContent = p.kind === 'document' ? String(p.px.w) : '-';
  ui.outH.textContent = p.kind === 'document' ? String(p.px.h) : '-';
}

function updateLive(crop: Rect): void {
  const out = outputSize(crop);
  ui.outW.textContent = String(out.w);
  ui.outH.textContent = String(out.h);
  const p = state.preset;
  const top =
    p.kind === 'document' && p.mm
      ? `${p.mm.w} × ${p.mm.h} mm · ${out.w} × ${out.h}`
      : `${out.w} × ${out.h} px`;
  cropper.setTags(top, state.lastBytes ? `${formatBytes(state.lastBytes)} …` : '');
}

async function measure(crop: Rect): Promise<void> {
  if (!state.working) return;
  const job = ++state.sizeJob;
  const out = outputSize(crop);
  const canvas = document.createElement('canvas');
  renderCrop(canvas, state.working, crop, out, state.format === 'png' ? null : '#ffffff');
  const blob = await withMetadata(await encode(canvas, state.format, QUALITY));
  if (job !== state.sizeJob) return; // a newer crop superseded this one

  const bytes = blob.size;
  state.lastBytes = bytes;
  const { value, unit } = splitBytes(bytes);
  ui.kbValue.textContent = value;
  ui.kbUnit.textContent = unit;

  const p = state.preset;
  const limit = p.kind === 'document' && p.maxKB ? p.maxKB * 1024 : 0;
  const bar = ui.kbBar.parentElement;
  let tone: 'ok' | 'warn' | 'plain' = 'plain';
  if (limit) {
    const over = bytes > limit;
    tone = over ? 'warn' : 'ok';
    ui.kbFlag.hidden = false;
    ui.kbFlag.dataset.tone = tone;
    ui.kbFlag.textContent = over ? 'Too big' : 'Fits';
    ui.kbBar.style.width = `${Math.min(100, (bytes / limit) * 100)}%`;
    bar?.classList.toggle('is-over', over);
    ui.kbLimit.textContent = `max ${formatBytes(limit)}`;
  } else {
    ui.kbFlag.hidden = true;
    bar?.classList.remove('is-over');
    ui.kbBar.style.width = `${Math.min(100, (bytes / Math.max(1, state.fileBytes)) * 100)}%`;
    ui.kbLimit.textContent = `of ${formatBytes(state.fileBytes)}`;
  }

  state.lastTone = tone;
  renderExportFacts(out);

  const quality = qualityLabel();
  ui.kbQuality.textContent = quality;

  const top =
    p.kind === 'document' && p.mm
      ? `${p.mm.w} × ${p.mm.h} mm · ${out.w} × ${out.h}`
      : `${out.w} × ${out.h} px`;
  cropper.setTags(top, `${formatBytes(bytes)}${tone === 'ok' ? ' ✓' : tone === 'warn' ? ' ✕' : ''}`, tone);
}

/* ---------- Live result preview ---------- */

const RESULT_BOX = 96 - 12; // thumb box minus breathing room, CSS px
let previewFrame = 0;
let lastMeasureAt = 0;

/** Draws the exported photo, scaled to fit the result card, at most once per frame. */
function drawResult(crop: Rect): void {
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(() => {
    if (!state.working) return;
    const out = outputSize(crop);
    const s = Math.min(RESULT_BOX / out.w, RESULT_BOX / out.h);
    const css = { w: Math.max(1, Math.round(out.w * s)), h: Math.max(1, Math.round(out.h * s)) };
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = ui.resultCanvas;
    renderCrop(
      c,
      state.working,
      crop,
      { w: Math.round(css.w * dpr), h: Math.round(css.h * dpr) },
      state.format === 'png' ? null : '#ffffff',
    );
    c.style.width = `${css.w}px`;
    c.style.height = `${css.h}px`;

    const p = state.preset;
    const up =
      p.kind === 'document' && crop.w < p.px.w * 0.98 ? ` · ×${(p.px.w / crop.w).toFixed(1)} upscale` : '';
    ui.resultDims.textContent = `${out.w} × ${out.h} px${up}`;
  });
}

cropper.onChange((crop, final) => {
  if (!state.working) return;
  updateLive(crop);
  drawResult(crop);
  // Re-encode for the real KB while dragging too, but no more than ~5 times a second.
  const now = performance.now();
  if (final || now - lastMeasureAt > 200) {
    lastMeasureAt = now;
    void measure(crop);
  }
});

cropper.onHistory(() => {
  ui.undo.disabled = !cropper.canUndo;
  ui.redo.disabled = !cropper.canRedo;
});

/* ---------- Format ---------- */

const FORMAT_HINT: Record<OutputFormat, string> = {
  jpeg: 'Smallest for photos. Accepted by almost every form.',
  png: 'Lossless and larger. Keeps transparent areas.',
  webp: 'Small and sharp, but some upload forms reject it.',
};

function qualityLabel(): string {
  const f = formatInfo[state.format];
  return f.lossy ? `${f.label} · ${Math.round(QUALITY * 100)}%` : `${f.label} · lossless`;
}

function setFormat(format: OutputFormat): void {
  state.format = format;
  ui.formats
    .querySelectorAll<HTMLButtonElement>('button[data-format]')
    .forEach((x) => x.setAttribute('aria-checked', String(x.dataset.format === format)));
  ui.ext.textContent = `.${formatInfo[format].ext}`;
  ui.formatHint.textContent = FORMAT_HINT[format];
  renderMetaControls();
  if (state.working) {
    ui.expBytes.textContent = 'Measuring…';
    ui.expFlag.hidden = true;
    drawResult(cropper.crop);
    void measure(cropper.crop);
  } else updateMeterEmpty();
}

ui.formats.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-format]');
  if (b?.dataset.format) setFormat(b.dataset.format as OutputFormat);
});

/* ---------- Loading & orienting ---------- */

function rebuildWorking(): void {
  if (!state.image) return;
  state.working = buildWorkingCanvas(state.image, state.natural, state.orientation);
  state.size = { w: state.working.width, h: state.working.height };
  renderRatios();
  cropper.setSource(state.working, state.size, presetRatio(state.preset, state.size));
}

async function loadFile(file: File): Promise<void> {
  if (file.type && !file.type.startsWith('image/')) {
    toast('error', 'That file isn’t an image. Choose a JPEG, PNG or WebP photo.');
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    toast(
      'error',
      heic
        ? 'This browser can’t open HEIC photos. On iPhone choose Settings › Camera › Formats › Most Compatible, or share the photo as JPEG.'
        : 'This image couldn’t be opened. Try a JPEG, PNG or WebP file.',
    );
    return;
  }

  let meta: PhotoMeta | null = null;
  try {
    const tiff = findExif(new Uint8Array(await file.arrayBuffer()));
    if (tiff) meta = parseExif(tiff);
  } catch {
    // Unreadable metadata is treated as none.
  }

  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  Object.assign(state, {
    meta,
    metaSummary: summarize(meta),
    keep: { location: false, camera: false },
    image: img,
    imageUrl: url,
    fileName: file.name,
    fileBytes: file.size,
    natural: { w: img.naturalWidth, h: img.naturalHeight },
    orientation: { turns: 0, flipX: false },
    lastBytes: 0,
  });
  ui.flip.setAttribute('aria-pressed', 'false');

  app.dataset.state = 'ready';
  ui.empty.hidden = true;
  ui.canvas.hidden = false;
  ui.dock.hidden = false;
  ui.fileChip.hidden = false;
  ui.fileChip.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight} · ${formatBytes(file.size)}`;
  ui.filename.value = defaultBaseName(file.name);

  rebuildWorking();
  ui.canvas.focus({ preventScroll: true });
}

function rotate(dir: 1 | -1): void {
  if (!state.image) return;
  state.orientation.turns = (state.orientation.turns + dir + 4) % 4;
  rebuildWorking();
}

function flip(): void {
  if (!state.image) return;
  state.orientation.flipX = !state.orientation.flipX;
  ui.flip.setAttribute('aria-pressed', String(state.orientation.flipX));
  rebuildWorking();
}

function toggleGuide(): void {
  if (state.preset.kind !== 'document') return;
  state.guideOn = !state.guideOn;
  ui.guide.setAttribute('aria-pressed', String(state.guideOn));
  cropper.setGuide(guideFor(state.preset));
}

/* ---------- Photo details (location / camera metadata) ---------- */

const canCarryMeta = () => state.format !== 'webp';

/** Adds the chosen metadata to an encoded file. Without a choice the file stays metadata-free. */
async function withMetadata(blob: Blob): Promise<Blob> {
  if (!canCarryMeta()) return blob;
  const tiff = buildExif(state.meta, state.keep);
  if (!tiff) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const out = state.format === 'png' ? insertExifPng(bytes, tiff) : insertExifJpeg(bytes, tiff);
  return new Blob([out], { type: blob.type });
}

function renderMetaControls(): void {
  const { location, camera } = state.metaSummary;
  const carry = canCarryMeta();
  // Only offer a switch for details this photo actually has; hide the group when it has none.
  ui.metaGroup.hidden = !location && !camera;
  const row = (
    input: HTMLInputElement,
    note: HTMLElement,
    found: string | null,
    key: 'location' | 'camera',
  ) => {
    const label = input.closest<HTMLElement>('.switch-row');
    if (label) label.hidden = !found;
    note.textContent = found ?? '';
    note.title = found ?? '';
    input.disabled = !carry;
    input.checked = Boolean(found) && carry && state.keep[key];
  };
  row(ui.keepGps, ui.metaGpsNote, location, 'location');
  row(ui.keepCam, ui.metaCamNote, camera, 'camera');

  ui.metaHint.hidden = carry || ui.metaGroup.hidden;
  ui.metaHint.textContent =
    'WebP files from KiloCrop can’t carry photo details. Pick JPEG or PNG to keep them.';

  // Footer: say only what this photo has - what's kept and what's removed.
  const kept: string[] = [];
  const removed: string[] = [];
  if (location) (ui.keepGps.checked ? kept : removed).push('location');
  if (camera) (ui.keepCam.checked ? kept : removed).push('camera details');
  // "details" is plural, so it takes "are" even on its own.
  const sentence = (list: string[], done: string) => {
    if (!list.length) return '';
    const t = list.join(' and ');
    const verb = list.length > 1 || t.endsWith('details') ? 'are' : 'is';
    return ` ${t.charAt(0).toUpperCase()}${t.slice(1)} ${verb} ${done}.`;
  };
  ui.metaStatus.textContent = 'Made on this device.' + sentence(kept, 'kept') + sentence(removed, 'removed');
}

function onKeepChange(): void {
  state.keep = { location: ui.keepGps.checked, camera: ui.keepCam.checked };
  renderMetaControls();
  if (state.working) {
    ui.expBytes.textContent = 'Measuring…';
    void measure(cropper.crop);
  }
}

ui.keepGps.addEventListener('change', onKeepChange);
ui.keepCam.addEventListener('change', onKeepChange);
ui.metaInfo.addEventListener('click', () => ui.metaHelp.showModal());
ui.metaHelp
  .querySelectorAll<HTMLButtonElement>('[data-close]')
  .forEach((b) => b.addEventListener('click', () => ui.metaHelp.close()));
ui.metaHelp.addEventListener('click', (e) => {
  if (e.target === ui.metaHelp) ui.metaHelp.close(); // click on the backdrop
});

/* ---------- Export dialog ---------- */

function renderExportFacts(out: Size): void {
  ui.expDims.textContent = `${out.w} × ${out.h} px`;
  ui.expBytes.textContent = state.lastBytes ? formatBytes(state.lastBytes) : '-';
  const p = state.preset;
  const tone = state.lastTone;
  ui.expFlag.hidden = tone === 'plain';
  if (tone !== 'plain' && p.kind === 'document') {
    ui.expFlag.dataset.tone = tone;
    ui.expFlag.textContent = tone === 'ok' ? `Fits ${p.maxKB} KB` : `Over ${p.maxKB} KB`;
  }
}

function openExport(): void {
  if (!state.working) {
    toast('error', 'Open a photo first.');
    return;
  }
  const crop = cropper.crop;
  const out = outputSize(crop);
  const s = Math.min(1, 220 / Math.max(out.w, out.h));
  renderCrop(
    ui.exportPreview,
    state.working,
    crop,
    { w: Math.max(1, Math.round(out.w * s)), h: Math.max(1, Math.round(out.h * s)) },
    state.format === 'png' ? null : '#ffffff',
  );
  if (!ui.filename.value.trim()) ui.filename.value = defaultBaseName(state.fileName || 'photo');
  ui.formatHint.textContent = FORMAT_HINT[state.format];
  renderExportFacts(out);
  renderMetaControls();
  ui.exportDialog.showModal();
  if (matchMedia('(pointer: fine)').matches) ui.filename.select();
}

async function download(): Promise<void> {
  if (!state.working) return;
  const crop = cropper.crop;
  const out = outputSize(crop);
  const canvas = document.createElement('canvas');
  renderCrop(canvas, state.working, crop, out, state.format === 'png' ? null : '#ffffff');
  const blob = await withMetadata(await encode(canvas, state.format, QUALITY));
  const { ext } = formatInfo[state.format];
  const name = toFilename(ui.filename.value, defaultBaseName(state.fileName || 'photo'), ext);

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  ui.exportDialog.close();
  toast('ok', `Saved ${name} - ${out.w} × ${out.h} px, ${formatBytes(blob.size)}`);
}

ui.exportForm.addEventListener('submit', (e) => {
  e.preventDefault(); // keep the dialog open until the file is ready
  void download();
});
ui.exportDialog
  .querySelectorAll<HTMLButtonElement>('[data-close]')
  .forEach((b) => b.addEventListener('click', () => ui.exportDialog.close()));
ui.exportDialog.addEventListener('click', (e) => {
  if (e.target === ui.exportDialog) ui.exportDialog.close(); // click on the backdrop
});

/* ---------- Panels (rail on desktop, tab bar on phones) ---------- */

const desktop = matchMedia('(min-width: 760px)');

function showTab(tab: Tab): void {
  app.dataset.tab = tab;
  document
    .querySelectorAll<HTMLButtonElement>('.rail-btn')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  const sec = document.querySelector<HTMLElement>(`.sec[data-section="${tab}"]`);
  if (desktop.matches && sec) {
    // Scroll only the inspector; scrollIntoView would also shift the whole page.
    const box = ui.inspector;
    const top = box.scrollTop + sec.getBoundingClientRect().top - box.getBoundingClientRect().top - 14;
    box.scrollTo({ top, behavior: 'smooth' });
    sec.classList.remove('is-flash');
    void sec.offsetWidth; // restart the highlight animation
    sec.classList.add('is-flash');
  }
}

document
  .querySelectorAll<HTMLButtonElement>('.rail-btn')
  .forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as Tab)));

/* ---------- Wiring ---------- */

const openPicker = () => ui.fileInput.click();
ui.choose.addEventListener('click', openPicker);
ui.newPhoto.addEventListener('click', openPicker);
ui.fileInput.addEventListener('change', () => {
  const f = ui.fileInput.files?.[0];
  if (f) void loadFile(f);
  ui.fileInput.value = ''; // allow choosing the same file again
});
ui.exportBtn.addEventListener('click', openExport);
ui.undo.addEventListener('click', () => cropper.undo());
ui.redo.addEventListener('click', () => cropper.redo());
ui.rotLeft.addEventListener('click', () => rotate(-1));
ui.rotRight.addEventListener('click', () => rotate(1));
ui.flip.addEventListener('click', flip);
ui.guide.addEventListener('click', toggleGuide);
ui.reset.addEventListener('click', () => cropper.reset());

// Keyboard shortcuts (ignored while typing or inside the picker).
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (ui.docs.open || ui.exportDialog.open || ui.metaHelp.open || t.closest('input, textarea, select'))
    return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) cropper.redo();
    else cropper.undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    cropper.redo();
  } else if (mod && k === 's') {
    e.preventDefault();
    openExport();
  } else if (mod && k === 'o') {
    e.preventDefault();
    openPicker();
  } else if (!mod && !e.altKey) {
    if (k === 'r') rotate(e.shiftKey ? -1 : 1);
    else if (k === 'f') flip();
    else if (k === 'g') toggleGuide();
  }
});

// Drop a photo anywhere in the window.
let dragDepth = 0;
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  app.classList.add('is-over');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    app.classList.remove('is-over');
  }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('is-over');
  const f = e.dataTransfer?.files[0];
  if (f) void loadFile(f);
});

// Tag widths depend on the mono font; re-place them once it has loaded.
void document.fonts.ready.then(() => cropper.draw());

applyPreset(state.preset);
