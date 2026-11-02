import type { ProviderPlugin } from '@/plugins/types';
import { isPluginEnabled, watchPluginPreferences } from '@/plugins/preferences';
import { observeProviderPage } from './content-observer';

/** Live lifecycle for a plugin's isolated observer and MAIN network bridge. */
export function startPluginContent(plugin: ProviderPlugin): () => void {
  let stopped = false;
  let version = 0;
  let enabled = false;
  let stopObserver: (() => void) | undefined;
  const syncBridge = () => window.dispatchEvent(new CustomEvent('modelport:plugin-control', {
    detail: { pluginId: plugin.id, enabled },
  }));
  const refresh = async () => {
    const requestVersion = ++version;
    try {
      const next = await isPluginEnabled(plugin.id);
      if (stopped || requestVersion !== version) return;
      enabled = next;
      if (enabled && !stopObserver) stopObserver = observeProviderPage(plugin.id);
      if (!enabled) { stopObserver?.(); stopObserver = undefined; }
      syncBridge();
    } catch {
      // Do not observe until the saved preference can be read.
    }
  };
  window.addEventListener('modelport:bridge-ready', syncBridge);
  const unwatch = watchPluginPreferences((id) => { if (id === plugin.id) void refresh(); });
  void refresh();
  return () => {
    stopped = true;
    version++;
    enabled = false;
    syncBridge();
    stopObserver?.();
    unwatch();
    window.removeEventListener('modelport:bridge-ready', syncBridge);
  };
}
