/** Meshy AI provider adapter — the first fully functional provider. */

import type { ProviderPlugin } from '../types';
import { isMeshyTaskLike, parseMeshyTask } from './schema';
import {
  mergeMeshyTask,
  normalizeMeshyTask,
  preferMeshyVariant,
} from './normalizer';
import { resolveMeshyAssets } from './resolver';
import { isMeshyEndpoint, meshyUuidFromPageUrl } from './urls';

const MESHY_ORIGINS = ['https://meshy.ai', 'https://www.meshy.ai', 'https://api.meshy.ai'];

export const meshyPlugin: ProviderPlugin = {
  id: 'meshy',
  displayName: 'Meshy AI',
  description: 'Detect Meshy models, textures, and variants.',
  defaultEnabled: true,
  hostPermissions: MESHY_ORIGINS.map((origin) => `${origin}/*`),
  detection: {
    matches: MESHY_ORIGINS.map((origin) => `${origin}/*`),
    isEndpoint: isMeshyEndpoint,
  },
  pageRequest(url) {
    const id = meshyUuidFromPageUrl(url.href);
    return id ? { url: `https://www.meshy.ai/meshyd-api/web/public/v2/tasks/${id}` } : undefined;
  },
  supportedOrigins: MESHY_ORIGINS,
  capabilities: {
    automaticDetection: true,
    localConversion: true,
    textures: true,
    originalDownload: true,
    supportedExports: ['original', 'glb', 'obj'],
  },

  matchesUrl(url: URL) {
    return MESHY_ORIGINS.includes(url.origin);
  },
  modelIdFromPage: meshyUuidFromPageUrl,

  recognizesPayload(payload: unknown) {
    return isMeshyTaskLike(parseMeshyTask(payload));
  },

  normalize(payload, provenance) {
    return normalizeMeshyTask(payload, provenance);
  },

  mergeTask(existing, incoming) {
    return mergeMeshyTask(existing, incoming);
  },

  preferVariant(model) {
    return preferMeshyVariant(model);
  },

  resolveAssets(model) {
    return resolveMeshyAssets(model);
  },
};
