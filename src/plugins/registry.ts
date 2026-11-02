/**
 * Provider registry — the single place a new provider becomes visible to
 * the app. Core code never imports provider adapters directly.
 */

import type { ProviderPlugin } from './types';
import { meshyPlugin } from './meshy';
import { rodinPlugin } from './rodin';

const plugins: ProviderPlugin[] = [meshyPlugin, rodinPlugin];

export const pluginRegistry = {
  all: () => [...plugins],
  get(id: string | undefined): ProviderPlugin | undefined {
    return plugins.find((p) => p.id === id);
  },
  /** Provider responsible for a URL, or undefined for unsupported sites. */
  forUrl(url: URL): ProviderPlugin | undefined {
    return plugins.find((p) => p.matchesUrl(url));
  },
  forOrigin(origin: string): ProviderPlugin | undefined {
    return plugins.find((p) =>
      p.supportedOrigins.some((o) => {
        try {
          return new URL(o).origin === origin;
        } catch {
          return false;
        }
      }),
    );
  },
};
