import type { ModelProvider } from '@/core/models/types';

/** Bundled site integration. File decoders remain independent of plugins. */
export interface ProviderPlugin extends ModelProvider {
  description: string;
  defaultEnabled: boolean;
  hostPermissions: string[];
  detection: {
    matches: string[];
    isEndpoint(url: URL): boolean;
  };
  /** Public, anonymous metadata request for a supported model-page URL. */
  pageRequest?(url: URL): {
    url: string;
    method?: 'GET' | 'POST';
    body?: string;
    loginMessage?: string;
  } | undefined;
}
