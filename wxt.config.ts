import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { pluginRegistry } from './src/plugins/registry';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Sharper alias for application code. WXT's own "@/~" aliases
        // keep pointing at the project root for entrypoints.
        '@': path.resolve(__dirname, 'src'),
      },
    },
  }),
  manifest: {
    name: 'Easy 3D Export',
    description:
      'Download models from Meshy and Hyper3D Rodin. Convert .meshy, Draco and GLB files to GLB/OBJ locally, without an API key.',
    permissions: ['sidePanel', 'activeTab', 'storage', 'downloads'],
    optional_host_permissions: ['https://*/*'],
    host_permissions: [...new Set(pluginRegistry.all().flatMap((plugin) => plugin.hostPermissions))],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
