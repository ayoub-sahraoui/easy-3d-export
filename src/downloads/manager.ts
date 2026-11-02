/**
 * Panel-side download manager.
 *
 * - fetches asset bytes directly in the extension panel (validated URLs, progress,
 *   cancellation);
 * - saves generated files via chrome.downloads with correct Blob lifecycle
 *   (object URLs are revoked only after the download settles);
 * - de-duplicates in-flight saves and sanitizes every filename.
 */

import { browser } from 'wxt/browser';
import { ModelError, toModelError } from '@/core/errors';
import type { PanelRequestResponse } from '@/core/messaging/types';
import { sanitizeFilename } from '@/downloads/filenames';
import { fetchAssetBytes, type FetchAssetOptions } from '@/downloads/asset-fetch';

const pendingRevoke = new Map<number, string>(); // downloadId → objectURL

export interface FetchAssetCallbacks {
  requestId: string;
  onProgress?: (received: number, total: number | undefined) => void;
}

const activeFetches = new Map<string, AbortController>();

/** Keep binary data in the panel: Chrome runtime messages serialize it as JSON. */
export async function fetchAsset(url: string, callbacks: FetchAssetCallbacks, request: Pick<FetchAssetOptions, 'method' | 'body' | 'maxBytes'> = {}): Promise<ArrayBuffer> {
  const controller = new AbortController();
  activeFetches.set(callbacks.requestId, controller);
  try {
    return await fetchAssetBytes(url, { ...request, signal: controller.signal, onProgress: callbacks.onProgress });
  } finally {
    activeFetches.delete(callbacks.requestId);
  }
}

export async function cancelFetch(requestId: string): Promise<void> {
  activeFetches.get(requestId)?.abort();
}

/**
 * Fetch asset bytes with the CORS optional-permission fallback.
 *
 * Asset hosts outside the declared provider origins can reject extension
 * fetches via CORS (no Access-Control-Allow-Origin). With a host permission,
 * the same fetch bypasses CORS entirely — so on that error we ask the user
 * for access to the asset's origin (chrome.permissions.request needs a user
 * gesture; callers reach here from click handlers) and retry once. If the
 * prompt was not shown or was declined, the error carries `origin` so the UI
 * can offer an explicit "grant access & retry" button on a fresh gesture.
 */
export async function fetchAssetWithPermission(
  url: string,
  requestId: string,
  onProgress?: (received: number, total: number | undefined) => void,
  request: Pick<FetchAssetOptions, 'method' | 'body' | 'maxBytes'> = {},
): Promise<ArrayBuffer> {
  const attempt = () => fetchAsset(url, { requestId, onProgress }, request);
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof ModelError && e.code === 'CORS_OR_PERMISSION_DENIED') {
      let origin = '';
      try {
        origin = new URL(url).origin;
      } catch {
        throw e;
      }
      const granted = await browser.permissions
        .request({ origins: [`${origin}/*`] })
        .catch(() => false);
      if (granted) return await attempt();
      throw new ModelError('CORS_OR_PERMISSION_DENIED', { origin });
    }
    throw e;
  }
}

/** Ask the background to stream a provider URL straight to disk. */
export async function downloadUrlToDisk(url: string, filename: string): Promise<number> {
  const response = (await browser.runtime.sendMessage({
    type: 'DOWNLOAD_URL',
    url,
    filename,
  })) as PanelRequestResponse;
  if (response.type === 'DOWNLOAD_STARTED') return response.downloadId;
  throw new ModelError('DOWNLOAD_FAILED', {
    message: response.type === 'DOWNLOAD_REJECTED' ? response.message : 'Download failed.',
  });
}

function waitForDownload(downloadId: number, objectUrl: string, timeoutMs = 5 * 60 * 1000) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      browser.downloads.onChanged.removeListener(listener);
      const url = pendingRevoke.get(downloadId);
      if (url) {
        pendingRevoke.delete(downloadId);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      if (err) reject(err);
      else resolve();
    };
    const listener = (delta: Browser.downloads.DownloadDelta) => {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (state === 'complete') finish();
      else if (state === 'interrupted') {
        finish(new ModelError('DOWNLOAD_FAILED', { message: 'The download was interrupted.' }));
      }
    };
    browser.downloads.onChanged.addListener(listener);
    pendingRevoke.set(downloadId, objectUrl);
    setTimeout(() => {
      if (!settled) {
        // Still downloading after the timeout: resolve anyway and let the
        // browser finish; revoke later via the listener if it fires.
        settled = true;
        browser.downloads.onChanged.removeListener(listener);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        resolve();
      }
    }, timeoutMs);
    void objectUrl; // keep referenced for the closure above
  });
}

/** Save generated bytes to disk with a safe filename. */
export async function saveBytes(bytes: ArrayBuffer, filename: string, mimeType: string): Promise<number> {
  const safe = sanitizeFilename(filename);
  const blob = new Blob([bytes], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await browser.downloads.download({
      url: objectUrl,
      filename: safe,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    void waitForDownload(downloadId, objectUrl).catch(() => undefined);
    return downloadId;
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw toModelError(e, 'DOWNLOAD_FAILED');
  }
}

/** True while a save for this content is already running (dedupe guard). */
export function isSavePendingFor(content: string): boolean {
  return pendingSaves.has(content);
}
const pendingSaves = new Set<string>();

export async function saveBytesOnce(
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<number> {
  const key = `${filename}:${bytes.byteLength}`;
  if (pendingSaves.has(key)) throw new ModelError('DOWNLOAD_FAILED', {
    message: 'This file is already being saved.',
  });
  pendingSaves.add(key);
  try {
    return await saveBytes(bytes, filename, mimeType);
  } finally {
    pendingSaves.delete(key);
  }
}
