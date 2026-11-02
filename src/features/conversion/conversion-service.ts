/**
 * Conversion service (Side Panel side): acquires source bytes (network or
 * local file), runs the worker pipeline, verifies GLB output with an
 * independent loader, then saves via the download manager.
 */

import { ModelError, toModelError } from '@/core/errors';
import type {
  ConversionJob,
  ExportFormat,
  ExportResult,
  ModelVariant,
  NormalizedModel,
  TextureInput,
} from '@/core/models/types';
import { cancelFetch, fetchAssetWithPermission as fetchAssetPermissionAware, saveBytesOnce } from '@/downloads/manager';
import { sniffImageMime } from '@/conversion/glb/texture-embed';
import { createConversionClient } from './worker-client';
import { verifyGlbWithThree } from './verify';

export interface ConversionTarget {
  model: NormalizedModel | null;
  variant: ModelVariant | undefined;
  format: ExportFormat;
  includeTextures: boolean;
  /** Manual local-file import overrides any network source. */
  localSource?: { name: string; bytes: ArrayBuffer };
  /** Texture files the user picked alongside a local model import. */
  localTextures?: TextureInput[];
  basename: string;
}

export interface ConversionCallbacks {
  onStage: (stage: ConversionJob['stage'], detail?: string, progress?: number) => void;
  onDone: (info: {
    filename: string;
    warnings: string[];
    triangles?: number;
    savedAt: number;
    /** Present when the caller requested collect mode (no disk save). */
    collected?: { data: ArrayBuffer; mimeType: string; files: { path: string; mimeType: string; byteLength: number }[]; packaged: boolean; format: string; stats?: ExportResult['stats'] };
  }) => void;
  onError: (error: ModelError) => void;
}

interface ActiveJob {
  jobId: string;
  client: ReturnType<typeof createConversionClient>;
  fetchRequestIds: Set<string>;
}
let activeJob: ActiveJob | null = null;

/** Cancel the in-flight conversion (cooperative in worker, aborts fetches). */
export function cancelActiveConversion(): void {
  if (!activeJob) return;
  activeJob.client.cancel(activeJob.jobId);
  for (const id of activeJob.fetchRequestIds) void cancelFetch(id);
  activeJob.client.terminate();
  activeJob = null;
}

let jobCounter = 0;
const nextJobId = () => `job_${Date.now().toString(36)}_${++jobCounter}`;

function variantModelAsset(variant: ModelVariant | undefined) {
  return variant?.assets.find((a) => a.kind === 'model' && (a.url || a.bytes));
}

/** Fetch bytes with the CORS optional-permission fallback (needs user gesture). */

export async function runConversion(
  target: ConversionTarget,
  callbacks: ConversionCallbacks,
  options: { save?: boolean } = {},
): Promise<void> {
  const save = options.save !== false;
  const jobId = nextJobId();
  const client = createConversionClient();
  const job: ActiveJob = { jobId, client, fetchRequestIds: new Set() };
  activeJob = job;
  const trackedFetch = (url: string, requestId: string, onProgress: (r: number, t?: number) => void) => {
    job.fetchRequestIds.add(requestId);
    return fetchAssetPermissionAware(url, requestId, onProgress).finally(() =>
      job.fetchRequestIds.delete(requestId),
    );
  };
  try {
    /* 1) Source bytes ---------------------------------------------- */
    callbacks.onStage('downloading', 'Downloading asset');
    let sourceBytes: ArrayBuffer;
    let sourceName: string;
    if (target.localSource) {
      sourceBytes = target.localSource.bytes.slice(0);
      sourceName = target.localSource.name;
    } else {
      const asset = variantModelAsset(target.variant);
      if (!asset?.url) {
        throw new ModelError('MODEL_NOT_FOUND', {
          message: 'This variant has no downloadable model file yet.',
        });
      }
      if (asset.expiresAt !== undefined && asset.expiresAt < Date.now()) {
        throw new ModelError('ASSET_URL_EXPIRED');
      }
      sourceBytes = await trackedFetch(asset.url, `${jobId}:model`, (received, total) => {
        callbacks.onStage('downloading', 'Downloading asset', total ? Math.round((received / total) * 100) : undefined);
      });
      sourceName = asset.filename ?? `${target.basename}.${asset.format || 'bin'}`;
    }

    /* 2) Optional textures ------------------------------------------ */
    let textures: TextureInput[] = (target.localTextures ?? []).map((texture) => ({ ...texture, bytes: texture.bytes.slice(0) }));
    if (target.includeTextures && target.format !== 'original') {
      const texAssets = (target.variant?.textures ?? []).filter((t) => !!t.url);
      for (const [i, tex] of texAssets.entries()) {
        try {
          const bytes = await trackedFetch(tex.url!, `${jobId}:tex${i}`, (received, total) => {
            callbacks.onStage('downloading', `Downloading texture ${i + 1}/${texAssets.length}`, total ? Math.round((received / total) * 100) : undefined);
          });
          const mime = sniffImageMime(bytes);
          if (!mime) continue; // invalid image → exporter warns
          textures.push({ name: tex.filename ?? `texture_${i}`, bytes, mimeType: mime });
        } catch (e) {
          const err = toModelError(e);
          if (err.code === 'CANCELLED') throw err;
          // Texture failure downgrades to a warning; conversion proceeds.
          callbacks.onStage('downloading', `Texture unavailable (${err.code})`);
        }
      }
    }

    /* 3) Worker conversion ------------------------------------------ */
    callbacks.onStage('decoding');
    const result = await new Promise<{
      filename: string;
      data: ArrayBuffer;
      mimeType: string;
      packaged: boolean;
      warnings: string[];
      triangles?: number;
      files: { path: string; mimeType: string; byteLength: number }[];
      stats?: ExportResult['stats'];
    }>((resolve, reject) => {
      client.onMessage = (msg) => {
        if (msg.type === 'STAGE' && msg.jobId === jobId) {
          callbacks.onStage(msg.stage, msg.detail, msg.progress);
        } else if (msg.type === 'DONE' && msg.jobId === jobId) {
          resolve({
            filename: msg.filename,
            data: msg.data,
            mimeType: msg.mimeType,
            packaged: msg.packaged,
            warnings: msg.warnings,
            triangles: msg.stats?.triangles,
            files: msg.files,
            stats: msg.stats,
          });
        } else if (msg.type === 'FAILED' && msg.jobId === jobId) {
          reject(new ModelError((msg.code as ModelError['code']) || 'UNKNOWN', { message: msg.message, detail: msg.detail }));
        }
      };
      const transfer = [sourceBytes, ...textures.map((t) => t.bytes)];
      client.convert(
        {
          type: 'CONVERT',
          jobId,
          source: { name: sourceName, bytes: sourceBytes },
          format: target.format,
          includeTextures: target.includeTextures,
          textures: textures.map((t) => ({ name: t.name, bytes: t.bytes, mimeType: t.mimeType })),
          basename: target.basename,
        },
        transfer,
      );
    });

    /* 4) Verify + save ---------------------------------------------- */
    callbacks.onStage('saving', `Verifying ${result.filename}`);
    if (!result.packaged && target.format === 'glb') {
      try {
        await verifyGlbWithThree(result.data);
      } catch (e) {
        throw new ModelError('EXPORT_FAILED', {
          message: 'The converted file failed output verification and was not saved.',
          detail: String(e),
        });
      }
    }
    if (save) {
      await saveBytesOnce(result.data, result.filename, result.mimeType);
    }
    callbacks.onStage('done', result.filename);
    callbacks.onDone({
      filename: result.filename,
      warnings: result.warnings,
      triangles: result.triangles,
      savedAt: Date.now(),
      ...(save
        ? {}
        : {
            collected: {
              data: result.data,
              mimeType: result.mimeType,
              files: result.files,
              packaged: result.packaged,
              format: target.format,
              stats: result.stats,
            },
          }),
    });
  } catch (e) {
    const err = toModelError(e, 'EXPORT_FAILED');
    callbacks.onStage('error', err.userMessage);
    callbacks.onError(err);
  } finally {
    if (activeJob === job) activeJob = null;
    client.terminate();
  }
}

/** Cancel is cooperative: workers discard results for cancelled jobs. */
