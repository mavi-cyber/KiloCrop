import { describe, expect, it } from 'vitest';
import { defaultBaseName, formatBytes, splitBytes, toFilename } from '../src/core/format';

describe('format', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5 * 1024 + 300)).toBe('5.3 KB');
    expect(formatBytes(240 * 1024)).toBe('240 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.50 MB');
    expect(splitBytes(87 * 1024)).toEqual({ value: '87', unit: 'KB' });
  });

  it('builds safe filenames', () => {
    expect(toFilename('my photo', 'x')).toBe('my photo.jpg');
    expect(toFilename('a/b:c?.PNG', 'x')).toBe('a-b-c-.jpg');
    expect(toFilename('  ', 'fallback')).toBe('fallback.jpg');
    expect(toFilename('pic.jpeg', 'x', 'webp')).toBe('pic.webp');
  });

  it('derives the default name from the upload', () => {
    expect(defaultBaseName('DP_10.png')).toBe('KiloCrop-DP_10');
    expect(defaultBaseName('noext')).toBe('KiloCrop-noext');
  });
});
