import { describe, expect, it } from 'vitest';
import {
  buildExif,
  findExif,
  insertExifJpeg,
  insertExifPng,
  parseExif,
  summarize,
  type ExifEntry,
} from '../src/core/metadata';

/* A small big-endian TIFF like a camera writes: IFD0 + Exif + GPS + a thumbnail IFD. */

const enc = new TextEncoder();
const str = (tag: number, s: string): ExifEntry => {
  const raw = enc.encode(`${s}\0`);
  return { tag, type: 2, count: raw.length, raw };
};
const rat = (tag: number, pairs: [number, number][]): ExifEntry => {
  const raw = new Uint8Array(pairs.length * 8);
  const dv = new DataView(raw.buffer);
  pairs.forEach(([n, d], k) => {
    dv.setUint32(k * 8, n);
    dv.setUint32(k * 8 + 4, d);
  });
  return { tag, type: 5, count: pairs.length, raw };
};
const long = (tag: number, v: number): ExifEntry => {
  const raw = new Uint8Array(4);
  new DataView(raw.buffer).setUint32(0, v);
  return { tag, type: 4, count: 1, raw };
};

/** Minimal big-endian TIFF writer for the fixture (IFDs laid out back to back). */
function cameraTiff(): Uint8Array {
  const ifds: ExifEntry[][] = [
    [
      str(0x010f, 'Canon'),
      str(0x0110, 'Canon EOS R6'),
      long(0x0112, 6 << 16),
      long(0x8769, 0),
      long(0x8825, 0),
    ],
    [str(0x9003, '2026:09:12 10:30:00'), str(0x927c, 'MAKERNOTE-SECRET'), str(0xa431, 'SERIAL123')],
    [
      str(0x0001, 'N'),
      rat(0x0002, [
        [24, 1],
        [51, 1],
        [3852, 100],
      ]),
      str(0x0003, 'E'),
      rat(0x0004, [
        [67, 1],
        [0, 1],
        [4, 1],
      ]),
    ],
    [long(0x0201, 0), long(0x0202, 4)], // thumbnail IFD1
  ];
  const size = (es: ExifEntry[]) =>
    2 +
    es.length * 12 +
    4 +
    es.reduce((n, e) => n + (e.raw.length > 4 ? e.raw.length + (e.raw.length & 1) : 0), 0);
  const offs: number[] = [];
  let at = 8;
  for (const es of ifds) {
    offs.push(at);
    at += size(es);
  }
  const ifd0 = ifds[0] ?? [];
  new DataView((ifd0[3] as ExifEntry).raw.buffer).setUint32(0, offs[1] ?? 0);
  new DataView((ifd0[4] as ExifEntry).raw.buffer).setUint32(0, offs[2] ?? 0);

  const out = new Uint8Array(at);
  const dv = new DataView(out.buffer);
  out.set([0x4d, 0x4d], 0);
  dv.setUint16(2, 42);
  dv.setUint32(4, 8);
  ifds.forEach((es, i) => {
    const base = offs[i] ?? 0;
    dv.setUint16(base, es.length);
    let data = base + 2 + es.length * 12 + 4;
    es.forEach((e, k) => {
      const p = base + 2 + k * 12;
      dv.setUint16(p, e.tag);
      dv.setUint16(p + 2, e.type);
      dv.setUint32(p + 4, e.count);
      if (e.raw.length <= 4) out.set(e.raw, p + 8);
      else {
        dv.setUint32(p + 8, data);
        out.set(e.raw, data);
        data += e.raw.length + (e.raw.length & 1);
      }
    });
    dv.setUint32(base + 2 + es.length * 12, i === 0 ? (offs[3] ?? 0) : 0); // IFD0 -> thumbnail
  });
  return out;
}

const fakeJpeg = () =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9]);

function fakePng(): Uint8Array<ArrayBuffer> {
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(13).fill(0), 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...iend]);
}

describe('photo metadata', () => {
  const meta = parseExif(cameraTiff());

  it('reads location and camera details', () => {
    expect(meta).not.toBeNull();
    expect(summarize(meta)).toEqual({ location: '24.8607, 67.0011', camera: 'Canon EOS R6 · 2026:09:12' });
    expect(summarize(null)).toEqual({ location: null, camera: null });
  });

  it('keeps nothing unless asked', () => {
    expect(buildExif(meta, { location: false, camera: false })).toBeNull();
  });

  it('keeps only the chosen groups and never the thumbnail, maker note or serial', () => {
    const gpsOnly = parseExif(buildExif(meta, { location: true, camera: false }) as Uint8Array);
    expect(summarize(gpsOnly)).toEqual({ location: '24.8607, 67.0011', camera: null });

    const camOnly = buildExif(meta, { location: false, camera: true }) as Uint8Array;
    const parsed = parseExif(camOnly);
    expect(summarize(parsed).location).toBeNull();
    expect(summarize(parsed).camera).toBe('Canon EOS R6 · 2026:09:12');
    const tags = parsed?.exif.map((e) => e.tag) ?? [];
    expect(tags).not.toContain(0x927c);
    expect(tags).not.toContain(0xa431);
    // Next-IFD offset of IFD0 is 0: no thumbnail directory follows.
    const dv = new DataView(camOnly.buffer);
    const n = dv.getUint16(8);
    expect(dv.getUint32(8 + 2 + n * 12)).toBe(0);
    // Orientation reset to 1 because rotation is baked into the pixels.
    const orient = parsed?.ifd0.find((e) => e.tag === 0x0112);
    expect(orient && new DataView(orient.raw.buffer).getUint16(0)).toBe(1);
  });

  it('round-trips through JPEG and PNG files', () => {
    const tiff = buildExif(meta, { location: true, camera: true }) as Uint8Array;
    const jpeg = insertExifJpeg(fakeJpeg(), tiff);
    expect(Array.from(jpeg.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(summarize(parseExif(findExif(jpeg) as Uint8Array)).location).toBe('24.8607, 67.0011');

    const png = insertExifPng(fakePng(), tiff);
    expect(summarize(parseExif(findExif(png) as Uint8Array)).camera).toBe('Canon EOS R6 · 2026:09:12');
  });

  it('finds nothing in files without metadata', () => {
    expect(findExif(fakeJpeg())).toBeNull();
    expect(findExif(fakePng())).toBeNull();
    expect(parseExif(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
