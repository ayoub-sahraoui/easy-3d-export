/**
 * Manual import paths (spec Strategy C/D):
 *  - paste provider JSON (merged by rootId like automatic detection);
 *  - paste a direct asset URL or a supported public model-page URL;
 *  - pick/drop local .meshy/.glb/.drc files plus texture images.
 */

import { ModelError, toModelError } from '@/core/errors';
import type { NormalizedModel, TextureInput } from '@/core/models/types';
import { fetchAssetWithPermission } from '@/downloads/manager';
import { pluginRegistry } from '@/plugins/registry';
import { isDracoBytes } from '@/conversion/draco/decode';
import { sniffImageMime } from '@/conversion/glb/texture-embed';
import { isGlbBytes } from '@/conversion/glb/container';
import { isMeshyFile } from '@/conversion/meshy/decrypt';
import { validateAssetUrl } from '@/core/security/url';
import { requirePluginEnabled } from '@/plugins/preferences';
import { usePanelStore, type LocalImport } from '@/stores/panel-store';

/** Parse pasted JSON into a normalized manual model. */
export async function importJsonText(text: string): Promise<NormalizedModel> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ModelError('INVALID_RESPONSE', { message: 'That text is not valid JSON.' });
  }
  const provider = pluginRegistry.all().find((item) => item.recognizesPayload(payload));
  if (!provider) {
    throw new ModelError('INVALID_RESPONSE', {
      message: 'This JSON does not match a supported provider response yet.',
    });
  }
  await requirePluginEnabled(provider.id);
  const model = provider.normalize(payload, { source: 'manual-json', detectedAt: Date.now() });
  if (!model) throw new ModelError('INVALID_RESPONSE');
  const resolved = await provider.resolveAssets(model);
  await requirePluginEnabled(provider.id);
  const store = usePanelStore.getState();
  const existing = store.manualModels.find((m) => m.id === resolved.id);
  const merged = existing ? provider.mergeTask(existing, resolved) : resolved;
  store.addManualModel(merged);
  return merged;
}

/** Import a public Meshy/Rodin model page or a direct asset URL. */
export async function importFromUrl(input: string): Promise<void> {
  let url: URL;
  try {
    url = validateAssetUrl(input);
  } catch {
    throw new ModelError('INVALID_RESPONSE', { message: 'Enter a complete HTTPS URL.' });
  }
  const plugin = pluginRegistry.forUrl(url);
  const request = plugin?.pageRequest?.(url);
  if (plugin && request) {
    await requirePluginEnabled(plugin.id);
    try {
      const bytes = await fetchAssetWithPermission(request.url, `import:${plugin.id}:${plugin.modelIdFromPage?.(url.href)}`, undefined, {
        ...(request.method ? { method: request.method } : {}),
        ...(request.body ? { body: request.body } : {}), maxBytes: 2 * 1024 * 1024,
      });
      await importJsonText(new TextDecoder().decode(bytes));
    } catch (cause) {
      if (request.loginMessage && cause instanceof ModelError && cause.code === 'ASSET_URL_EXPIRED') {
        throw new ModelError('ASSET_DOWNLOAD_FAILED', { message: request.loginMessage });
      }
      throw cause;
    }
    return;
  }
  // Direct asset URL: fetch and import as a local file.
  const bytes = await fetchAssetWithPermission(url.href, `import:${url.hostname}`);
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? 'model') || 'model';
  setLocalFromBytes(name, bytes);
}

function setLocalFromBytes(name: string, bytes: ArrayBuffer, textures: TextureInput[] = []) {
  if (isMeshyFile(bytes)) {
    usePanelStore.getState().setLocalImport({ name, bytes, kind: 'meshy', textures });
    return;
  }
  if (isGlbBytes(bytes)) {
    usePanelStore.getState().setLocalImport({ name, bytes, kind: 'glb', textures });
    return;
  }
  if (isDracoBytes(bytes)) {
    usePanelStore.getState().setLocalImport({ name, bytes, kind: 'drc', textures });
    return;
  }
  throw new ModelError('MODEL_DECODE_FAILED', {
    message: 'That file is not a supported .meshy, .glb, or .drc model.',
  });
}

/** Import local files: one model + optional texture images. */
export async function importLocalFiles(files: File[]): Promise<void> {
  const modelFile =
    files.find((f) => /\.(meshy|glb|drc)$/i.test(f.name));
  const textures: TextureInput[] = [];
  for (const file of files) {
    if (file === modelFile) continue;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) continue;
    const bytes = await file.arrayBuffer();
    const mime = sniffImageMime(bytes);
    if (mime) textures.push({ name: file.name, bytes, mimeType: mime });
  }
  if (!modelFile) {
    if (textures.length > 0) {
      // Texture-only drop: attach to an existing local import if present.
      const existing = usePanelStore.getState().localImport;
      if (existing) {
        usePanelStore.getState().setLocalImport({ ...existing, textures: [...existing.textures, ...textures] });
        return;
      }
    }
    throw new ModelError('MODEL_NOT_FOUND', {
      message: 'Select a .meshy, .glb, or .drc model file (textures are optional).',
    });
  }
  const bytes = await modelFile.arrayBuffer();
  setLocalFromBytes(modelFile.name, bytes, textures);
}

export { toModelError };
