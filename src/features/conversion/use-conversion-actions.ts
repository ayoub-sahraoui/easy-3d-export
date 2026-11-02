/**
 * Wire-up between the Side Panel UI and the conversion/download services.
 * All button handlers live here so components stay declarative.
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { toModelError } from '@/core/errors';
import type { ConversionJob, ExportFormat, ExportResult, NormalizedModel } from '@/core/models/types';
import { downloadUrlToDisk, fetchAssetWithPermission, saveBytesOnce } from '@/downloads/manager';
import { buildDownloadAllZip } from '@/downloads/zip';
import { toFileBaseName } from '@/lib/utils';
import { pluginRegistry } from '@/plugins/registry';
import { selectCurrentModel, usePanelStore } from '@/stores/panel-store';
import { cancelActiveConversion, runConversion } from './conversion-service';

let counter = 0;
const jobId = () => `ui_${Date.now().toString(36)}_${++counter}`;

function pickVariant(model: NormalizedModel, variantId: string | undefined) {
  const provider = pluginRegistry.get(model.provider);
  return model.variants.find((v) => v.id === variantId) ?? provider?.preferVariant(model) ?? model.variants[0];
}

export function useConversionActions() {
  const store = usePanelStore;

  const buildTarget = useCallback(
    (format: ExportFormat) => {
      const state = store.getState();
      const model = selectCurrentModel(state);
      if (!model) return null;
      const variant = pickVariant(model, state.selectedVariantId);
      const local = state.localImport;
      return {
        target: {
          model,
          variant,
          format,
          includeTextures: state.includeTextures,
          localSource: local ? { name: local.name, bytes: local.bytes } : undefined,
          localTextures: local?.textures,
          basename: toFileBaseName(model.name),
        },
        model,
        variant,
      };
    },
    [store],
  );

  const start = useCallback(
    async (formatOverride?: ExportFormat) => {
      const state = store.getState();
      if (state.job && !['done', 'error', 'cancelled'].includes(state.job.stage)) return;
      const built = buildTarget(formatOverride ?? state.format);
      if (!built) return;
      const { target } = built;
      store.getState().setJob({
        id: jobId(),
        modelId: target.model?.id ?? 'local',
        variantId: target.variant?.id ?? 'local',
        format: target.format,
        includeTextures: target.includeTextures,
        stage: 'downloading',
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await runConversion(target, {
        onStage: (stage, detail, progress) => {
          const current = store.getState().job;
          // Keep the measurable download progress; other stages are indeterminate.
          store.getState().patchJob({ stage, stageDetail: detail, progress: stage === 'downloading' ? progress : undefined });
          if (current?.stage !== stage) void current;
        },
        onDone: (info) => {
          store.getState().patchJob({ stage: 'done', resultFilename: info.filename, progress: 100 });
          store.getState().setJobWarnings(info.warnings);
          store.getState().setLastSaved({ filename: info.filename, at: info.savedAt, warnings: info.warnings });
          toast.success(`Saved ${info.filename}`, {
            description: info.warnings[0],
          });
        },
        onError: (error) => {
          store.getState().patchJob({
            stage: error.code === 'CANCELLED' ? 'cancelled' : 'error',
            error: { code: error.code, message: error.userMessage, ...(error.origin ? { origin: error.origin } : {}) },
          });
          if (error.code !== 'CANCELLED') toast.error(error.userMessage);
        },
      });
    },
    [buildTarget, store],
  );

  /** Grant access to a blocked asset origin on a fresh user gesture, then retry. */
  const grantAccessAndRetry = useCallback(
    async (origin: string) => {
      try {
        const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
        if (!granted) {
          toast.error('Access was not granted.');
          return;
        }
        toast.success(`Access to ${origin} granted — retrying`);
        await start();
      } catch (e) {
        toast.error(toModelError(e).userMessage);
      }
    },
    [start],
  );

  const cancel = useCallback(() => {
    cancelActiveConversion();
    store.getState().patchJob({ stage: 'cancelled' });
  }, [store]);

  const downloadOriginal = useCallback(async () => {
    const built = buildTarget('original');
    if (!built) return;
    const { model, variant } = built;
    const local = store.getState().localImport;
    try {
      if (local) {
        await saveBytesOnce(local.bytes, local.name, 'application/octet-stream');
        toast.success(`Saved ${local.name}`);
        return;
      }
      const asset = variant?.assets.find((a) => a.kind === 'model' && a.url);
      if (!asset?.url) {
        toast.error('No downloadable original for this variant yet.');
        return;
      }
      await downloadUrlToDisk(asset.url, asset.filename ?? `${toFileBaseName(model.name)}.${asset.format || 'bin'}`);
      toast.success('Original download started');
    } catch (e) {
      toast.error(toModelError(e).userMessage);
    }
  }, [buildTarget, store]);

  const downloadTextures = useCallback(
    async () => {
      const built = buildTarget('original');
      if (!built) return;
      const textures = built.variant?.textures ?? [];
      if (textures.length === 0) {
        toast.error('No texture maps are available for this model.');
        return;
      }
      try {
        for (const [index, texture] of textures.entries()) {
          const filename = texture.filename ?? `texture_${index + 1}.png`;
          if (texture.bytes) {
            await saveBytesOnce(texture.bytes, filename, texture.mimeType ?? 'application/octet-stream');
          } else if (texture.url) {
            await downloadUrlToDisk(texture.url, filename);
          } else {
            throw new Error('A texture map has no downloadable file.');
          }
        }
        toast.success(textures.length === 1 ? 'Texture download started' : `${textures.length} texture downloads started`);
      } catch (e) {
        toast.error(toModelError(e).userMessage);
      }
    },
    [buildTarget],
  );

  const downloadAll = useCallback(async () => {
    const state = store.getState();
    const built = buildTarget(state.localImport ? 'glb' : state.format === 'original' ? 'glb' : state.format);
    if (!built) return;
    const { model, variant } = built;
    const job: ConversionJob = {
      id: jobId(),
      modelId: model.id,
      variantId: variant?.id ?? 'local',
      format: 'original',
      includeTextures: state.includeTextures,
      stage: 'downloading',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.getState().setJob({ ...job });
    try {
      // 1) Original bytes + textures.
      const originalFiles: { path: string; bytes: ArrayBuffer }[] = [];
      let localSourceBytes: ArrayBuffer | undefined;
      if (state.localImport) {
        localSourceBytes = state.localImport.bytes;
        originalFiles.push({ path: state.localImport.name, bytes: state.localImport.bytes });
        for (const tex of state.localImport.textures) originalFiles.push({ path: tex.name, bytes: tex.bytes });
      } else {
        const asset = variant?.assets.find((a) => a.kind === 'model' && a.url);
        if (asset?.url) {
          const bytes = await fetchAssetWithPermission(asset.url, `all:${asset.id}`);
          localSourceBytes = bytes;
          originalFiles.push({ path: asset.filename ?? `model.${asset.format || 'bin'}`, bytes });
        }
        for (const [i, tex] of (variant?.textures ?? []).entries()) {
          if (!tex.url) continue;
          try {
            const bytes = await fetchAssetWithPermission(tex.url, `all:tex${i}`);
            originalFiles.push({ path: tex.filename ?? `texture_${i}.png`, bytes });
          } catch {
            /* best effort */
          }
        }
      }

      // 2) Run both conversions in collect mode.
      const conversions: ExportResult[] = [];
      for (const format of ['glb', 'obj'] as const) {
        await runConversion(
          {
            model,
            variant,
            format,
            includeTextures: state.includeTextures,
            localSource: localSourceBytes ? { name: 'model', bytes: localSourceBytes.slice(0) } : undefined,
            localTextures: state.localImport?.textures,
            basename: toFileBaseName(model.name),
          },
          {
            onStage: (stage, detail) => store.getState().patchJob({ stage, stageDetail: detail }),
            onDone: (info) => {
              if (info.collected) conversions.push(info.collected as ExportResult);
            },
            onError: (e) => {
              throw e;
            },
          },
          { save: false },
        );
      }

      // 3) Package + save.
      store.getState().patchJob({ stage: 'exporting', stageDetail: 'Packaging ZIP' });
      const { bytes, filename } = await buildDownloadAllZip({
        model,
        basename: toFileBaseName(model.name),
        originalFiles,
        conversions,
      });
      await saveBytesOnce(bytes, filename, 'application/zip');
      store.getState().patchJob({ stage: 'done', resultFilename: filename, progress: 100 });
      store.getState().setLastSaved({ filename, at: Date.now(), warnings: [] });
      toast.success(`Saved ${filename}`);
    } catch (e) {
      const err = toModelError(e);
      store.getState().patchJob({
        stage: err.code === 'CANCELLED' ? 'cancelled' : 'error',
        error: { code: err.code, message: err.userMessage, ...(err.origin ? { origin: err.origin } : {}) },
      });
      if (err.code !== 'CANCELLED') toast.error(err.userMessage);
    }
  }, [buildTarget, store]);

  return { start, cancel, grantAccessAndRetry, downloadOriginal, downloadTextures, downloadAll };
}
