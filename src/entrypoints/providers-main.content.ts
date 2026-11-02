import { defineContentScript } from 'wxt/utils/define-content-script';
import { pluginRegistry } from '@/plugins/registry';
import { startPluginBridge } from '@/features/detection/plugin-bridge';

export default defineContentScript({
  matches: pluginRegistry.all().flatMap((plugin) => plugin.detection.matches),
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const plugin = pluginRegistry.forUrl(new URL(location.href));
    if (plugin) startPluginBridge(plugin);
  },
});
