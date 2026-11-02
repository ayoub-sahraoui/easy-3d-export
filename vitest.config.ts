import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    // Node 22 has WebCrypto + WebAssembly: the conversion pipeline runs as-is.
    testTimeout: 30_000,
  },
});
