import { browser } from 'wxt/browser';
import type { BridgeEvent } from '@/core/messaging/types';
import type { ProviderId } from '@/core/models/types';
import { payloadSignature, scanDocument } from '@/features/detection/page-scan';

const BRIDGE_EVENT = 'modelport:bridge';
const MAX_FORWARDED = 2 * 1024 * 1024;

/** Shared observer, replay, and page scanning for registered providers. */
export function observeProviderPage(providerId: ProviderId): () => void {
  let stopped = false;
  const seen = new Set<string>();
  // A bounded replay lets a restarted background recover without a page reload.
  const recent = new Map<string, { payload: unknown; source: 'network-response' | 'json-document' | 'page-scan'; url: string }>();
  const send = (candidate: { payload: unknown; source: 'network-response' | 'json-document' | 'page-scan'; url: string }) =>
    browser.runtime.sendMessage({
      type: 'MODEL_PAYLOAD_DETECTED',
      providerId,
      payload: candidate.payload,
      provenance: { source: candidate.source, url: candidate.url },
    });

  const forward = (payload: unknown, source: 'network-response' | 'json-document' | 'page-scan', url: string) => {
    if (stopped) return;
    const signature = payloadSignature(payload, url);
    if (seen.has(signature)) return;
    seen.add(signature);
    if (seen.size > 500) seen.clear();
    const candidate = { payload, source, url };
    recent.set(signature, candidate);
    if (recent.size > 8) recent.delete(recent.keys().next().value!);
    void send(candidate).catch(() => seen.delete(signature));
  };

  // 1) Bridge events (main world → here → background).
  const onBridge = (event: Event) => {
    const detail = (event as CustomEvent<BridgeEvent>).detail;
    if (!detail || detail.bridge !== 'modelport' || detail.kind !== 'response' || typeof detail.url !== 'string') return;
    const body = detail.bodyText;
    if (typeof body !== 'string' || body.length === 0 || body.length > MAX_FORWARDED) return;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        forward(parsed, 'network-response', detail.url);
      }
    } catch {
      /* not JSON: ignore */
    }
  };
  window.addEventListener(BRIDGE_EVENT, onBridge);

  // 2) Page inspection.
  const scan = () => {
    if (stopped) return;
    for (const candidate of scanDocument(document, location.href)) {
      forward(candidate.payload, candidate.source, candidate.url);
    }
  };
  scan();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });

  // SPA-friendly light re-scan: only when <pre>/<script> nodes appear.
  let scanTimer: number | undefined;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) =>
      [...m.addedNodes].some((n) => n instanceof Element && (n.matches('pre, script') || !!n.querySelector('pre, script'))),
    );
    if (!relevant) return;
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 1200);
  });
  observer.observe(document, { childList: true, subtree: true });

  // 3) Background-triggered re-scan (panel opened / refresh nudges).
  const onMessage = (msg: unknown) => {
    if ((msg as { type?: string })?.type === 'SCAN_PAGE') {
      for (const candidate of recent.values()) void send(candidate).catch(() => undefined);
      scan();
    }
  };
  browser.runtime.onMessage.addListener(onMessage);

  // 4) Announce readiness so the panel knows the observer is live.
  void browser.runtime.sendMessage({ type: 'CONTENT_READY', providerId }).catch(() => undefined);
  return () => {
    stopped = true;
    observer.disconnect();
    window.clearTimeout(scanTimer);
    window.removeEventListener(BRIDGE_EVENT, onBridge);
    document.removeEventListener('DOMContentLoaded', scan);
    browser.runtime.onMessage.removeListener(onMessage);
  };
}
