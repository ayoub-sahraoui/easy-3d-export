import type { ProviderPlugin } from '@/plugins/types';
import { installNetworkBridge } from './bridge';

const CONTROL_EVENT = 'modelport:plugin-control';
const READY_EVENT = 'modelport:bridge-ready';

/** MAIN cannot read extension storage; the isolated script controls observation. */
export function startPluginBridge(plugin: ProviderPlugin): () => void {
  let disposeBridge: (() => void) | undefined;
  const onControl = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.pluginId !== plugin.id || typeof detail.enabled !== 'boolean') return;
    if (detail.enabled && !disposeBridge) {
      disposeBridge = installNetworkBridge(window, {
        allow: plugin.detection.isEndpoint,
        maxBodyBytes: 2 * 1024 * 1024,
        emit: (response) => window.dispatchEvent(new CustomEvent('modelport:bridge', { detail: response })),
      });
    } else if (!detail.enabled) {
      disposeBridge?.();
      disposeBridge = undefined;
    }
  };
  window.addEventListener(CONTROL_EVENT, onControl);
  window.dispatchEvent(new Event(READY_EVENT));
  return () => {
    window.removeEventListener(CONTROL_EVENT, onControl);
    disposeBridge?.();
  };
}
