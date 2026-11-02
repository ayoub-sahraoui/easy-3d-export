import type { ModelStatus, NormalizedModel } from '@/core/models/types';
import type { ProviderPlugin } from '../types';
import { isSafeAssetUrl, parseSignedUrlExpiry } from '../../core/security/url';
import { isRodinEndpoint, rodinUuidFromPageUrl } from './urls';
import { parseRodinTask } from './schema';

const RODIN_ORIGINS = ['https://hyper3d.ai', 'https://www.hyper3d.ai', 'https://api.hyper3d.com'];

function safeUrl(value: string | undefined): string | undefined {
  return value && isSafeAssetUrl(value) ? value : undefined;
}

export const rodinPlugin: ProviderPlugin = {
  id: 'rodin',
  displayName: 'Hyper3D Rodin',
  description: 'Detect Rodin preview geometry and download models.',
  defaultEnabled: true,
  hostPermissions: [...RODIN_ORIGINS, 'https://file.hyper3d.com'].map((origin) => `${origin}/*`),
  detection: {
    matches: ['https://hyper3d.ai/*', 'https://www.hyper3d.ai/*'],
    isEndpoint: isRodinEndpoint,
  },
  pageRequest(url) {
    const id = rodinUuidFromPageUrl(url.href);
    return id ? {
      url: `https://api.hyper3d.com/api/task/card/${id}`, method: 'POST', body: '{}',
      loginMessage: 'This Rodin task requires your workspace login. Open its page and refresh it to detect the model.',
    } : undefined;
  },
  supportedOrigins: RODIN_ORIGINS,
  capabilities: {
    automaticDetection: true, localConversion: true, textures: false,
    originalDownload: true, supportedExports: ['original', 'glb', 'obj'],
  },
  matchesUrl(url) {
    return RODIN_ORIGINS.includes(url.origin);
  },
  modelIdFromPage: rodinUuidFromPageUrl,
  recognizesPayload(payload) { return !!parseRodinTask(payload); },
  normalize(payload, provenance): NormalizedModel | null {
    const task = parseRodinTask(payload);
    if (!task) return null;
    const id = task.task_uuid.toLowerCase();
    const source = safeUrl(task.model_preview_info?.preview_sdf);
    const modelUrl = source && new URL(source).pathname.toLowerCase().endsWith('.drc') ? source : undefined;
    const previewUrl = safeUrl(task.image_url) ?? safeUrl(task.card_poster_info?.preview_image);
    const status: ModelStatus = modelUrl ? 'succeeded' :
      /fail|error/i.test(task.user_state ?? task.step ?? '') ? 'failed' :
      task.pending_jobs?.length ? 'processing' : 'pending';
    const timestamp = task.generate_time ?? task.time;
    const at = timestamp ? Date.parse(timestamp) : NaN;
    return {
      id, provider: 'rodin', name: `Rodin model ${id.slice(0, 8)}`, status,
      previewUrl, provenance,
      ...(Number.isFinite(at) ? { updatedAt: at } : {}),
      variants: [{
        id: `${id}:preview`, label: 'Preview geometry', kind: 'generated', status,
        sourceTaskId: id, textures: [],
        assets: [
          ...(modelUrl ? [{
            id: `${id}:geometry`, kind: 'model' as const, format: 'drc', url: modelUrl,
            filename: `Rodin_${id}.drc`, expiresAt: parseSignedUrlExpiry(modelUrl),
          }] : []),
          ...(previewUrl ? [{ id: `${id}:preview-image`, kind: 'preview' as const, format: 'webp', url: previewUrl }] : []),
        ],
      }],
    };
  },
  mergeTask(existing, incoming) { return { ...existing, ...incoming }; },
  preferVariant(model) { return model.variants[0]; },
  async resolveAssets(model) { return model; },
};
