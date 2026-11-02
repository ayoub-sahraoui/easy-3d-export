/**
 * Background service worker:
 *  - opens the Side Panel on toolbar click;
 *  - validates + normalizes payloads from content scripts (untrusted data);
 *  - keeps per-tab model state and pushes updates to the Side Panel;
 *  - serves download and permission actions only for validated inputs.
 */

import { browser } from 'wxt/browser';
import { TabStore } from '@/core/background/tab-store';
import { hasMessageType, type PanelPushMessage } from '@/core/messaging/types';
import type {
  ContentToBackgroundMessage,
  PanelRequest,
  PanelRequestResponse,
} from '@/core/messaging/types';
import { toModelError } from '@/core/errors';
import { pluginRegistry } from '@/plugins/registry';
import { isPluginEnabled, watchPluginPreferences } from '@/plugins/preferences';
import { sanitizeFilename } from '@/downloads/filenames';
import { validateAssetUrl } from '@/core/security/url';

export default defineBackground(() => {
  const store = new TabStore();
  const panelPorts = new Set<Browser.runtime.Port>();
  const pushVersions = new Map<number, number>();

  const broadcast = (msg: PanelPushMessage) => {
    for (const port of panelPorts) {
      try {
        port.postMessage(msg);
      } catch {
        panelPorts.delete(port);
      }
    }
  };

  const pushTabState = async (tabId: number) => {
    const version = (pushVersions.get(tabId) ?? 0) + 1;
    pushVersions.set(tabId, version);
    const state = store.get(tabId);
    const enabled = state?.providerId ? await isPluginEnabled(state.providerId).catch(() => false) : false;
    if (pushVersions.get(tabId) !== version) return;
    broadcast({
      type: 'TAB_MODELS_UPDATED',
      tabId,
      providerId: state?.providerId,
      pluginEnabled: enabled,
      models: enabled ? store.listModels(tabId) : [],
      observing: enabled && (state?.observing ?? false),
    });
  };

  watchPluginPreferences((id) => {
    for (const tabId of store.tabIds()) {
      if (store.get(tabId)?.providerId === id) void pushTabState(tabId);
    }
  });

  /* ---- Side panel on toolbar click --------------------------------- */
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e: unknown) => console.error('[modelport] side panel behavior failed', e));

  /* ---- Panel push channel ------------------------------------------ */
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'modelport-panel') return;
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    // Initial snapshot for the active tab.
    void (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id !== undefined) {
          void pushTabState(tab.id);
          void browser.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' }).catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    })();
  });

  /* ---- Content-script detections (untrusted data) ------------------- */
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (hasMessageType<ContentToBackgroundMessage>(msg, 'MODEL_PAYLOAD_DETECTED')) {
      void handleDetection(msg, sender).catch(() => undefined);
      sendResponse({ type: 'ACK' });
      return false;
    }
    if (hasMessageType<ContentToBackgroundMessage>(msg, 'CONTENT_READY')) {
      void handleReady(msg.providerId, sender);
      sendResponse({ type: 'ACK' });
      return false;
    }

    if (
      typeof msg === 'object' &&
      msg !== null &&
      typeof (msg as { type?: unknown }).type === 'string' &&
      [
        'GET_TAB_STATE',
        'DOWNLOAD_URL',
        'CHECK_HOST_PERMISSION',
        'ENSURE_HOST_PERMISSION',
        'OPEN_SIDE_PANEL',
      ].includes((msg as { type: string }).type)
    ) {
      void handlePanelRequest(msg as PanelRequest, sendResponse);
      return true; // async sendResponse
    }
    return false;
  });

  async function handleReady(providerId: string, sender: Browser.runtime.MessageSender) {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? sender.url;
    const plugin = pluginRegistry.get(providerId);
    try {
      if (tabId === undefined || !url || !plugin?.matchesUrl(new URL(url)) || !await isPluginEnabled(providerId)) return;
      store.markObserving(tabId, providerId, url);
      await pushTabState(tabId);
      void browser.tabs.sendMessage(tabId, { type: 'SCAN_PAGE' }).catch(() => undefined);
    } catch { /* a closed tab or unavailable preferences can retry on the next scan */ }
  }

  async function handleDetection(msg: ContentToBackgroundMessage, sender: Browser.runtime.MessageSender) {
    const tabId = sender.tab?.id;
    if (tabId === undefined || msg.type !== 'MODEL_PAYLOAD_DETECTED') return;
    const provider = pluginRegistry.get(msg.providerId);
    if (!provider || !await isPluginEnabled(provider.id)) return;
    // The claiming provider must match the tab the message came from.
    const tabUrl = sender.tab?.url ?? sender.url ?? '';
    try { if (!provider.matchesUrl(new URL(tabUrl))) return; } catch { return; }
    if (tabUrl) store.noteUrl(tabId, tabUrl);
    try {
      if (!provider.recognizesPayload(msg.payload)) return;
      const model = provider.normalize(msg.payload, {
        source: msg.provenance.source,
        url: msg.provenance.url,
        detectedAt: Date.now(),
      });
      if (!model) return;
      await store.upsertModel(tabId, model);
      await pushTabState(tabId);
    } catch (e) {
      console.warn('[modelport] detection rejected', toModelError(e).code);
    }
  }

  async function handlePanelRequest(msg: PanelRequest, sendResponse: (r: PanelRequestResponse) => void) {
    try {
      switch (msg.type) {
        case 'GET_TAB_STATE': {
          const tab =
            msg.tabId !== undefined
              ? await browser.tabs.get(msg.tabId)
              : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
          if (!tab || tab.id === undefined) {
            sendResponse({ type: 'ERROR', code: 'MODEL_NOT_FOUND', message: 'No active tab.' });
            return;
          }
          // tab.url is present when activeTab is granted or the host is allowlisted.
          const url = tab.url ?? tab.pendingUrl ?? store.get(tab.id)?.url;
          let providerId = store.get(tab.id)?.providerId;
          if (url) {
            try {
              providerId = pluginRegistry.forUrl(new URL(url))?.id;
            } catch {
              /* keep reported provider */
            }
          }
          const provider = pluginRegistry.get(providerId);
          const enabled = provider ? await isPluginEnabled(provider.id) : false;
          if (url) {
            const state = store.noteUrl(tab.id, url);
            state.providerId = provider?.id;
          }
          sendResponse({
            type: 'TAB_STATE',
            tabId: tab.id,
            supported: !!provider,
            pluginEnabled: enabled,
            providerId: provider?.id,
            models: enabled ? store.listModels(tab.id) : [],
            observing: enabled && (store.get(tab.id)?.observing ?? false),
            url,
          });
          return;
        }
        case 'DOWNLOAD_URL': {
          try {
            validateAssetUrl(msg.url);
          } catch {
            sendResponse({ type: 'DOWNLOAD_REJECTED', message: 'This URL is not safe to download.' });
            return;
          }
          const filename = sanitizeFilename(msg.filename);
          try {
            const downloadId = await browser.downloads.download({
              url: msg.url,
              filename,
              conflictAction: 'uniquify',
              saveAs: false,
            });
            sendResponse({ type: 'DOWNLOAD_STARTED', downloadId });
          } catch (e) {
            sendResponse({ type: 'DOWNLOAD_REJECTED', message: toModelError(e, 'DOWNLOAD_FAILED').userMessage });
          }
          return;
        }
        case 'CHECK_HOST_PERMISSION':
        case 'ENSURE_HOST_PERMISSION': {
          // permissions.request must originate from a user gesture in an
          // extension page — the Side Panel calls it directly; the background
          // only reports the current state.
          const granted = await browser.permissions.contains({ origins: [`${msg.origin}/*`] });
          sendResponse({ type: 'PERMISSION_STATE', granted });
          return;
        }
        case 'OPEN_SIDE_PANEL': {
          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.windowId !== undefined) {
            await browser.sidePanel.open({ windowId: tab.windowId });
            sendResponse({ type: 'ERROR', code: 'ACK', message: 'ack' });
          } else {
            sendResponse({ type: 'ERROR', code: 'UNKNOWN', message: 'No active window.' });
          }
          return;
        }
      }
    } catch (e) {
      const err = toModelError(e);
      sendResponse({ type: 'ERROR', code: err.code, message: err.userMessage });
    }
  }

  /* ---- Tab lifecycle ------------------------------------------------ */
  browser.tabs.onActivated.addListener(({ tabId }) => {
    broadcast({ type: 'ACTIVE_TAB_CHANGED', tabId });
    void pushTabState(tabId);
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // Full navigation clears models; SPA navigation changes the page selection.
    if (changeInfo.status === 'loading') {
      store.resetModels(tabId);
    }
    if (changeInfo.url) store.noteUrl(tabId, changeInfo.url);
    if (changeInfo.status === 'loading' || changeInfo.url) {
      void pushTabState(tabId);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    store.delete(tabId);
    pushVersions.delete(tabId);
  });
});
