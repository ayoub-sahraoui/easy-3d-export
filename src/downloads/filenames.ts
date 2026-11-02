/** Filename sanitization for downloads (defense against path traversal). */

/** Produce a safe single-segment filename; never empty, never a path. */
export function sanitizeFilename(name: string, fallback = 'model'): string {
  const cleaned = (name ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}

/** Build a download-safe filename from a basename + extension. */
export function downloadFilename(base: string, ext: string): string {
  const safeBase = sanitizeFilename(base, 'model');
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${safeBase}.${safeExt}`;
}
