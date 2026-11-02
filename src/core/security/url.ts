/**
 * URL security helpers.
 *
 * Every URL that comes from page data or captured responses is treated as
 * untrusted input. Only HTTPS URLs on public hosts without credentials are
 * accepted, and signed query tokens are redacted before anything is logged.
 */

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Validate an externally supplied URL for fetching/downloading.
 * Throws UnsafeUrlError with a readable reason; returns the URL object on success.
 */
export function validateAssetUrl(input: string): URL {
  const trimmed = (input ?? '').trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only HTTPS URLs are accepted');
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are rejected');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    IPV4.test(host) ||
    host.includes(':') ||
    !host.includes('.')
  ) {
    throw new UnsafeUrlError('Local or non-public hosts are rejected');
  }
  return url;
}

export function isSafeAssetUrl(input: string): boolean {
  try {
    validateAssetUrl(input);
    return true;
  } catch {
    return false;
  }
}

/** Remove signed query tokens for display/logging. Never log full signed URLs. */
export function redactUrlForDisplay(input: string | undefined): string {
  if (!input) return '';
  try {
    const u = new URL(input);
    // Build manually: URL.search would percent-encode the ellipsis.
    return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return 'invalid-url';
  }
}

/**
 * Parse signed-URL expiry when the provider uses a recognizable scheme.
 * Meshy pattern: `?sign=1793664000-token…` (unix seconds prefix).
 * Returns epoch ms, or undefined when unknown.
 */
export function parseSignedUrlExpiry(url: string | undefined): number | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const sign = u.searchParams.get('sign');
    if (sign) {
      const m = /^(\d{9,13})/.exec(sign);
      if (m) {
        const n = Number(m[1]);
        // Heuristic: values < ~10^11 are unix seconds.
        return n > 1e12 ? n : n * 1000;
      }
    }
    // GCS: response-content-dispatch style with expires param in seconds epoch
    const expires = u.searchParams.get('expires') ?? u.searchParams.get('Expires');
    if (expires && /^\d{9,13}$/.test(expires)) {
      const n = Number(expires);
      return n > 1e12 ? n : n * 1000;
    }
    for (const prefix of ['X-Goog', 'X-Amz', 'X-Tos']) {
      const date = u.searchParams.get(`${prefix}-Date`);
      const lifetime = u.searchParams.get(`${prefix}-Expires`);
      if (!date || !lifetime || !/^\d{8}T\d{6}Z$/.test(date) || !/^\d+$/.test(lifetime)) continue;
      const start = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
      const expiry = start + Number(lifetime) * 1000;
      if (Number.isSafeInteger(expiry)) return expiry;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
