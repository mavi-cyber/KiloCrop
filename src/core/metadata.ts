/**
 * Photo metadata (EXIF): read it from the original file and, only when the user
 * asks, write a trimmed copy into the exported file.
 *
 * Canvas exports carry no metadata at all, so "remove" is the default. "Keep"
 * rebuilds a small EXIF block from two groups the user can choose:
 *   - location: the whole GPS directory
 *   - camera:   make, model, lens, exposure settings, dates, software, author
 * Always dropped: the embedded thumbnail (it can show the uncropped photo),
 * maker notes, and camera / lens serial numbers.
 */

export interface ExifEntry {
  tag: number;
  type: number;
  count: number;
  /** Value bytes in the original byte order. */
  raw: Uint8Array;
}

export interface PhotoMeta {
  littleEndian: boolean;
  ifd0: ExifEntry[];
  exif: ExifEntry[];
  gps: ExifEntry[];
}

export interface KeepOptions {
  location: boolean;
  camera: boolean;
}

const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

const TAG = {
  orientation: 0x0112,
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
  make: 0x010f,
  model: 0x0110,
  dateTimeOriginal: 0x9003,
  lensModel: 0xa434,
  gpsLatRef: 0x0001,
  gpsLat: 0x0002,
  gpsLonRef: 0x0003,
  gpsLon: 0x0004,
} as const;

/** IFD0 tags that count as "camera details". */
const CAMERA_IFD0 = new Set([0x010f, 0x0110, 0x0131, 0x0132, 0x013b, 0x8298]);
/** Exif-directory tags never copied: maker notes, pointers, old pixel sizes, serials, owner name. */
const EXIF_DROP = new Set([0x927c, 0xa005, 0xa002, 0xa003, 0xa430, 0xa431, 0xa435]);

/* ---------- Finding the EXIF block inside a file ---------- */

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** Returns the TIFF-structured EXIF payload from a JPEG, PNG or WebP file, if it has one. */
export function findExif(file: Uint8Array): Uint8Array | null {
  if (file[0] === 0xff && file[1] === 0xd8) return findInJpeg(file);
  if (ascii(file, 1, 3) === 'PNG') return findInPng(file);
  if (ascii(file, 0, 4) === 'RIFF' && ascii(file, 8, 4) === 'WEBP') return findInWebp(file);
  return null;
}

function findInJpeg(b: Uint8Array): Uint8Array | null {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break; // image data starts: no more headers
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (marker === 0xe1 && ascii(b, i + 4, 4) === 'Exif') return b.slice(i + 10, i + 2 + len);
    i += 2 + len;
  }
  return null;
}

function findInPng(b: Uint8Array): Uint8Array | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  while (i + 8 <= b.length) {
    const len = dv.getUint32(i);
    const type = ascii(b, i + 4, 4);
    if (type === 'eXIf') return b.slice(i + 8, i + 8 + len);
    if (type === 'IDAT' || type === 'IEND') break;
    i += 12 + len;
  }
  return null;
}

function findInWebp(b: Uint8Array): Uint8Array | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = dv.getUint32(i + 4, true);
    if (type === 'EXIF') {
      let data = b.slice(i + 8, i + 8 + len);
      if (ascii(data, 0, 4) === 'Exif') data = data.slice(6);
      return data;
    }
    i += 8 + len + (len & 1);
  }
  return null;
}

/* ---------- Parsing ---------- */

function readIfd(dv: DataView, offset: number, le: boolean): { entries: ExifEntry[] } {
  const entries: ExifEntry[] = [];
  if (offset < 8 || offset + 2 > dv.byteLength) return { entries };
  const n = dv.getUint16(offset, le);
  for (let k = 0; k < n; k++) {
    const e = offset + 2 + k * 12;
    if (e + 12 > dv.byteLength) break;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const count = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 0) * count;
    if (!size) continue;
    const at = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    if (at + size > dv.byteLength) continue;
    entries.push({ tag, type, count, raw: new Uint8Array(dv.buffer, dv.byteOffset + at, size).slice() });
  }
  return { entries };
}

const pointer = (entries: ExifEntry[], tag: number, le: boolean): number => {
  const e = entries.find((x) => x.tag === tag);
  return e && e.raw.length >= 4 ? new DataView(e.raw.buffer).getUint32(0, le) : 0;
};

/** Parses a TIFF/EXIF payload. Returns null when it isn't valid EXIF. */
export function parseExif(tiff: Uint8Array): PhotoMeta | null {
  if (tiff.length < 8) return null;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (dv.getUint16(2, le) !== 42) return null;
  const ifd0 = readIfd(dv, dv.getUint32(4, le), le).entries;
  const exif = readIfd(dv, pointer(ifd0, TAG.exifPointer, le), le).entries;
  const gps = readIfd(dv, pointer(ifd0, TAG.gpsPointer, le), le).entries;
  return { littleEndian: le, ifd0, exif, gps };
}

/* ---------- Human-readable summary for the export dialog ---------- */

const text = (e?: ExifEntry) =>
  e && e.type === 2 ? new TextDecoder().decode(e.raw).replace(/\0+$/, '').trim() : '';

function rationals(e: ExifEntry | undefined, le: boolean): number[] {
  if (!e || (e.type !== 5 && e.type !== 10)) return [];
  const dv = new DataView(e.raw.buffer);
  const out: number[] = [];
  for (let k = 0; k < e.count; k++) {
    const den = dv.getUint32(k * 8 + 4, le);
    out.push(den ? dv.getUint32(k * 8, le) / den : 0);
  }
  return out;
}

export interface MetaSummary {
  /** e.g. "24.8607, 67.0011" */
  location: string | null;
  /** e.g. "Apple iPhone 13 · 2026:09:12" */
  camera: string | null;
}

export function summarize(meta: PhotoMeta | null): MetaSummary {
  if (!meta) return { location: null, camera: null };
  const le = meta.littleEndian;
  const find = (list: ExifEntry[], tag: number) => list.find((e) => e.tag === tag);

  let location: string | null = null;
  const lat = rationals(find(meta.gps, TAG.gpsLat), le);
  const lon = rationals(find(meta.gps, TAG.gpsLon), le);
  if (lat.length === 3 && lon.length === 3) {
    const deg = (d: number[]) => (d[0] ?? 0) + (d[1] ?? 0) / 60 + (d[2] ?? 0) / 3600;
    const latV = deg(lat) * (text(find(meta.gps, TAG.gpsLatRef)) === 'S' ? -1 : 1);
    const lonV = deg(lon) * (text(find(meta.gps, TAG.gpsLonRef)) === 'W' ? -1 : 1);
    if (latV || lonV) location = `${latV.toFixed(4)}, ${lonV.toFixed(4)}`;
  } else if (meta.gps.length) {
    location = 'Location data found';
  }

  const make = text(find(meta.ifd0, TAG.make));
  const model = text(find(meta.ifd0, TAG.model));
  const lens = text(find(meta.exif, TAG.lensModel));
  const date = text(find(meta.exif, TAG.dateTimeOriginal)).slice(0, 10);
  const name = model.toLowerCase().startsWith(make.toLowerCase())
    ? model
    : [make, model].filter(Boolean).join(' ');
  const parts = [name || lens, date].filter(Boolean);
  const hasCamera = meta.ifd0.some((e) => CAMERA_IFD0.has(e.tag)) || meta.exif.length > 0;
  const camera = parts.length ? parts.join(' · ') : hasCamera ? 'Camera data found' : null;

  return { location, camera };
}

/* ---------- Writing a trimmed EXIF block ---------- */

function ifdSize(entries: ExifEntry[]): number {
  const data = entries.reduce((n, e) => n + (e.raw.length > 4 ? e.raw.length + (e.raw.length & 1) : 0), 0);
  return 2 + entries.length * 12 + 4 + data;
}

/**
 * Builds a fresh TIFF/EXIF payload with only the groups the user chose, or null
 * if nothing would be kept. Orientation is written as 1 because rotation is
 * already baked into the exported pixels.
 */
export function buildExif(meta: PhotoMeta | null, keep: KeepOptions): Uint8Array | null {
  if (!meta || (!keep.location && !keep.camera)) return null;
  const le = meta.littleEndian;

  const gps = keep.location ? [...meta.gps] : [];
  const exif = keep.camera ? meta.exif.filter((e) => !EXIF_DROP.has(e.tag)) : [];
  const ifd0Base = keep.camera ? meta.ifd0.filter((e) => CAMERA_IFD0.has(e.tag)) : [];
  if (!gps.length && !exif.length && !ifd0Base.length) return null;

  const u16 = (v: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, le);
    return b;
  };
  const u32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, le);
    return b;
  };

  // IFD0 = chosen tags + orientation + pointers (pointer values patched once offsets are known).
  const ifd0: ExifEntry[] = [...ifd0Base, { tag: TAG.orientation, type: 3, count: 1, raw: u16(1) }];
  if (exif.length) ifd0.push({ tag: TAG.exifPointer, type: 4, count: 1, raw: u32(0) });
  if (gps.length) ifd0.push({ tag: TAG.gpsPointer, type: 4, count: 1, raw: u32(0) });
  const sortByTag = (a: ExifEntry, b: ExifEntry) => a.tag - b.tag;
  ifd0.sort(sortByTag);
  exif.sort(sortByTag);
  gps.sort(sortByTag);

  const at0 = 8;
  const atExif = at0 + ifdSize(ifd0);
  const atGps = atExif + (exif.length ? ifdSize(exif) : 0);
  const total = atGps + (gps.length ? ifdSize(gps) : 0);
  for (const e of ifd0) {
    if (e.tag === TAG.exifPointer) e.raw = u32(atExif);
    if (e.tag === TAG.gpsPointer) e.raw = u32(atGps);
  }

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  dv.setUint16(2, 42, le);
  dv.setUint32(4, at0, le);

  const writeIfd = (entries: ExifEntry[], at: number) => {
    dv.setUint16(at, entries.length, le);
    let data = at + 2 + entries.length * 12 + 4;
    entries.forEach((e, k) => {
      const p = at + 2 + k * 12;
      dv.setUint16(p, e.tag, le);
      dv.setUint16(p + 2, e.type, le);
      dv.setUint32(p + 4, e.count, le);
      if (e.raw.length <= 4) {
        out.set(e.raw, p + 8);
      } else {
        dv.setUint32(p + 8, data, le);
        out.set(e.raw, data);
        data += e.raw.length + (e.raw.length & 1);
      }
    });
    dv.setUint32(at + 2 + entries.length * 12, 0, le); // no next IFD: no thumbnail
  };
  writeIfd(ifd0, at0);
  if (exif.length) writeIfd(exif, atExif);
  if (gps.length) writeIfd(gps, atGps);
  return out;
}

/* ---------- Putting EXIF into an exported file ---------- */

/** Inserts an APP1 Exif segment right after the JPEG's start (and JFIF header, if any). */
export function insertExifJpeg(jpeg: Uint8Array<ArrayBuffer>, tiff: Uint8Array): Uint8Array<ArrayBuffer> {
  const segLen = 2 + 6 + tiff.length;
  if (segLen > 0xffff) return jpeg; // too large for one segment; export without it
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + (((jpeg[4] ?? 0) << 8) | (jpeg[5] ?? 0));
  const seg = new Uint8Array(2 + segLen);
  seg.set([0xff, 0xe1, segLen >> 8, segLen & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  seg.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(seg, at);
  out.set(jpeg.subarray(at), at + seg.length);
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserts an eXIf chunk right after the PNG's IHDR chunk. */
export function insertExifPng(png: Uint8Array<ArrayBuffer>, tiff: Uint8Array): Uint8Array<ArrayBuffer> {
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  const chunk = new Uint8Array(12 + tiff.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4); // "eXIf"
  chunk.set(tiff, 8);
  dv.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}
