import { defineContentScript } from 'wxt/utils/define-content-script';
import { pluginRegistry } from '@/plugins/registry';
import { startPluginContent } from '@/features/detection/plugin-content';

export default defineContentScript({
  matches: pluginRegistry.all().flatMap((plugin) => plugin.detection.matches),
  runAt: 'document_start',
  main(ctx) {
    const plugin = pluginRegistry.forUrl(new URL(location.href));
    if (plugin) ctx.onInvalidated(startPluginContent(plugin));
  },
});
