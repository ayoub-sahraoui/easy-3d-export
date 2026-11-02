/**
 * Asset byte fetching from the extension context.
 *
 * Security posture: HTTPS-only, credentials omitted, no referrer, size
 * capped, redirects surfaced for validation, and clear error codes for the
 * three failure families users actually hit (expired link, network failure,
 * CORS/permission denial). Signed URLs are never logged.
 */

import { ModelError } from '@/core/errors';
import { validateAssetUrl, UnsafeUrlError } from '@/core/security/url';

export interface FetchAssetOptions {
  method?: 'GET' | 'POST';
  body?: string;
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number | undefined) => void;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

export async function fetchAssetBytes(url: string, options: FetchAssetOptions = {}): Promise<ArrayBuffer> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let parsed: URL;
  try {
    parsed = validateAssetUrl(url);
  } catch (e) {
    if (e instanceof UnsafeUrlError) {
      throw new ModelError('ASSET_DOWNLOAD_FAILED', { message: `This asset link is not safe to fetch: ${e.message}` });
    }
    throw e;
  }

  let response: Response;
  try {
    response = await fetch(parsed.href, {
      method: options.method ?? 'GET',
      ...(options.body !== undefined ? { body: options.body, headers: { 'Content-Type': 'application/json' } } : {}),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      signal: options.signal,
    });
  } catch (e) {
    if (options.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
      throw new ModelError('CANCELLED', { cause: e });
    }
    // TypeError from fetch = network/CORS rejection.
    throw new ModelError('CORS_OR_PERMISSION_DENIED', {
      detail: 'fetch rejected (network or CORS)',
      cause: e,
    });
  }

  if (response.status === 403 || response.status === 410 || response.status === 401) {
    throw new ModelError('ASSET_URL_EXPIRED', {
      detail: `HTTP ${response.status} from ${parsed.origin}`,
    });
  }
  if (!response.ok) {
    throw new ModelError('ASSET_DOWNLOAD_FAILED', {
      detail: `HTTP ${response.status}`,
    });
  }
  // Validate the final URL after redirects.
  try {
    validateAssetUrl(response.url || parsed.href);
  } catch {
    throw new ModelError('ASSET_DOWNLOAD_FAILED', { message: 'The asset redirected somewhere unsafe.' });
  }

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new ModelError('FILE_TOO_LARGE');

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new ModelError('FILE_TOO_LARGE');
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ModelError('FILE_TOO_LARGE');
      }
      chunks.push(value);
      options.onProgress?.(received, declared > 0 ? declared : undefined);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}
