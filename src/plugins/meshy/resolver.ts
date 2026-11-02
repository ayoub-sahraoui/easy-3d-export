/**
 * Meshy asset enrichment: filenames, signed-URL expiry, safe-URL filtering.
 * Network-free by design — bytes are fetched by the download manager, not here.
 */

import type { NormalizedModel } from '@/core/models/types';
import { isSafeAssetUrl, parseSignedUrlExpiry } from '../../core/security/url';

function filenameFromUrl(url: string, fallbackExt: string, hint: string): string {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    if (base && /\.[a-z0-9]{1,8}$/i.test(base)) return base;
    return `${hint}.${fallbackExt}`;
  } catch {
    return `${hint}.${fallbackExt}`;
  }
}

export async function resolveMeshyAssets(model: NormalizedModel): Promise<NormalizedModel> {
  const variants = model.variants.map((variant) => ({
    ...variant,
    assets: variant.assets.map((asset) => {
      if (!asset.url) return asset;
      if (!isSafeAssetUrl(asset.url)) return { ...asset, url: undefined };
      const ext = asset.format || 'bin';
      const hint =
        asset.kind === 'texture' || asset.kind === 'preview'
          ? `${variant.id.split(':')[0]}_${asset.kind}`
          : model.name.replace(/\s+/g, '_').slice(0, 60) || 'model';
      return {
        ...asset,
        filename: asset.filename ?? filenameFromUrl(asset.url, ext, hint),
        expiresAt: asset.expiresAt ?? parseSignedUrlExpiry(asset.url),
      };
    }),
    textures: variant.textures.map((texture) => {
      if (!texture.url) return texture;
      if (!isSafeAssetUrl(texture.url)) return { ...texture, url: undefined };
      return {
        ...texture,
        filename: texture.filename ?? filenameFromUrl(texture.url, 'png', `texture_${texture.id.slice(-1)}`),
        expiresAt: texture.expiresAt ?? parseSignedUrlExpiry(texture.url),
      };
    }),
  }));
  if (model.previewUrl && !isSafeAssetUrl(model.previewUrl)) {
    return { ...model, variants, previewUrl: undefined };
  }
  return { ...model, variants };
}
