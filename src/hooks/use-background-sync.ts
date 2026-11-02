/** Keeps the panel synchronized through background restarts and tab changes. */
import { useEffect } from 'react';
import { browser } from 'wxt/browser';
import { usePanelStore } from '@/stores/panel-store';
import type { PanelPushMessage, PanelRequestResponse } from '@/core/messaging/types';

export function useBackgroundSync(): void {
  useEffect(() => {
    let stopped = false;
    let version = 0;
    let port: Browser.runtime.Port | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      const requestVersion = ++version;
      try {
        const response = await browser.runtime.sendMessage({ type: 'GET_TAB_STATE' }) as PanelRequestResponse | undefined;
        if (!stopped && requestVersion === version && response?.type === 'TAB_STATE') {
          usePanelStore.getState().applyTabState(response);
        }
      } catch {
        // A disconnected port schedules reconnection; focus also retries.
      }
    };

    const onTabActivated = () => {
      usePanelStore.setState({ activeTabId: undefined });
      void refresh();
    };
    const onPush = (message: unknown) => {
      const push = message as PanelPushMessage;
      if (stopped || !push || typeof push !== 'object') return;
      if (push.type === 'ACTIVE_TAB_CHANGED') {
        onTabActivated();
      } else if (push.type === 'TAB_MODELS_UPDATED') {
        const state = usePanelStore.getState();
        if (state.activeTabId === undefined) {
          void refresh();
        } else if (push.tabId === state.activeTabId) {
          // A newer push must win over any older request still in flight.
          version++;
          state.applyTabState({ ...push, supported: !!push.providerId, url: state.tabUrl });
        }
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== undefined) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, 1000);
    };
    const onDisconnect = () => {
      port?.onMessage.removeListener(onPush);
      port?.onDisconnect.removeListener(onDisconnect);
      port = undefined;
      scheduleReconnect();
    };
    const connect = () => {
      if (stopped || port) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      try {
        port = browser.runtime.connect({ name: 'modelport-panel' });
        port.onMessage.addListener(onPush);
        port.onDisconnect.addListener(onDisconnect);
        void refresh();
      } catch {
        scheduleReconnect();
      }
    };
    const onFocus = () => { if (port) void refresh(); else connect(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
    const onTabUpdated = (tabId: number, change: { url?: string; status?: string }) => {
      if (tabId === usePanelStore.getState().activeTabId && (change.url || change.status === 'complete')) void refresh();
    };

    browser.tabs.onActivated.addListener(onTabActivated);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    connect();

    return () => {
      stopped = true;
      version++;
      clearTimeout(reconnectTimer);
      browser.tabs.onActivated.removeListener(onTabActivated);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      port?.onMessage.removeListener(onPush);
      port?.onDisconnect.removeListener(onDisconnect);
      port?.disconnect();
    };
  }, []);
}
