export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** Number and unit separately, for big readouts: 87 / KB. */
export function splitBytes(bytes: number): { value: string; unit: string } {
  const [value = '0', unit = 'B'] = formatBytes(bytes).split(' ');
  return { value, unit };
}

// Characters Windows/macOS/Android refuse in filenames, including control characters.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Turns user input into a safe filename with the given extension, falling back when empty. */
export function toFilename(input: string, fallback: string, ext = 'jpg'): string {
  let name = input.trim().replace(ILLEGAL, '-').replace(/\s+/g, ' ');
  name = name.replace(/\.(jpe?g|png|webp)$/i, '');
  if (!name || /^\.+$/.test(name)) name = fallback;
  return `${name.slice(0, 120)}.${ext}`;
}

/** "holiday photo.PNG" → "KiloCrop-holiday photo" */
export function defaultBaseName(original: string): string {
  const dot = original.lastIndexOf('.');
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `KiloCrop-${stem}`;
}
