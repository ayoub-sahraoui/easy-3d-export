/**
 * Main-world network observer.
 *
 * Wraps `fetch` and `XMLHttpRequest` once per page to observe JSON responses
 * from allowlisted provider endpoints. Rules:
 *  - the original methods' behavior is fully preserved;
 *  - fetch bodies are observed through `response.clone()` — the original
 *    response is never consumed or modified;
 *  - only allowlisted URLs with JSON content types are inspected;
 *  - bodies above the cap are dropped (never partially parsed);
 *  - no request headers, credentials or cookies are read or recorded;
 *  - the bridge is idempotent and disposable.
 */

import type { BridgeEvent } from '@/core/messaging/types';

export interface BridgeOptions {
  /** Whether a response URL is worth inspecting. */
  allow: (url: URL) => boolean;
  /** Max JSON body size to capture (bytes of text). */
  maxBodyBytes: number;
  /** Sink for captured events. */
  emit: (event: BridgeEvent) => void;
}

const FLAG = '__modelportBridgeInstalled';

interface WindowWithBridge extends Window {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  [FLAG]?: () => void;
}

export function installNetworkBridge(window: Window, options: BridgeOptions): () => void {
  const w = window as WindowWithBridge;
  if (w[FLAG]) return w[FLAG]; // idempotent

  const { allow, maxBodyBytes, emit } = options;
  let active = true;

  const contentTypeJson = (ct: string | null) => !!ct && ct.toLowerCase().includes('json');

  const captureText = (url: string, text: string | null | undefined) => {
    if (!active || typeof text !== 'string' || text.length === 0 || text.length > maxBodyBytes) return;
    emit({ bridge: 'modelport', version: 1, kind: 'response', url, bodyText: text });
  };

  // --- fetch ---------------------------------------------------------
  const originalFetch = w.fetch;
  const patchedFetch: typeof fetch = async function (input, init) {
    const response = await originalFetch.call(w, input, init);
    try {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const finalUrl = new URL(rawUrl, w.location.href);
      const effective = new URL(response.url || finalUrl.href);
      if (active && allow(effective) && contentTypeJson(response.headers.get('content-type'))) {
        // observe only; never consume the original response body
        const clone = response.clone();
        void clone
          .text()
          .then((text) => captureText(effective.href, text))
          .catch(() => undefined);
      }
    } catch {
      /* observation failures never affect the page */
    }
    return response;
  };
  w.fetch = patchedFetch;

  // --- XMLHttpRequest ------------------------------------------------
  const xhrProto = w.XMLHttpRequest.prototype as XMLHttpRequestPrototype;
  const originalOpen: (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) => void = xhrProto.open;
  const originalSend: (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) => void = xhrProto.send;

  const openUrl = new WeakMap<XMLHttpRequest, string>();
  xhrProto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    try {
      openUrl.set(this, new URL(String(url), w.location.href).href);
    } catch {
      /* malformed URL: not ours to observe */
    }
    if (async === undefined) return originalOpen.call(this, method, url);
    return originalOpen.call(this, method, url, async, username ?? null, password ?? null);
  };
  xhrProto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this;
    const href = openUrl.get(xhr);
    if (href) {
      xhr.addEventListener('load', () => {
        try {
          const effective = new URL(xhr.responseURL || href);
          if (!active || !allow(effective)) return;
          if (!contentTypeJson(xhr.getResponseHeader('content-type'))) return;
          const text: string | null =
            xhr.responseType === '' || xhr.responseType === 'text'
              ? xhr.responseText
              : xhr.responseType === 'json'
                ? JSON.stringify(xhr.response)
                : null;
          captureText(effective.href, text);
        } catch {
          /* ignore */
        }
      });
    }
    return originalSend.call(xhr, body);
  };

  const dispose = () => {
    active = false;
    if (w.fetch === patchedFetch) w.fetch = originalFetch;
    if (xhrProto.open !== originalOpen) xhrProto.open = originalOpen;
    if (xhrProto.send !== originalSend) xhrProto.send = originalSend;
    delete w[FLAG];
  };
  w[FLAG] = dispose;
  return dispose;
}

interface XMLHttpRequestPrototype {
  open: typeof XMLHttpRequest.prototype.open;
  send: typeof XMLHttpRequest.prototype.send;
}
