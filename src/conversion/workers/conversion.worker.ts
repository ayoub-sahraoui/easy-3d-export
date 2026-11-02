/**
 * Dedicated conversion worker: keeps decrypt/decompress/export off the
 * Side Panel's main thread. Transferable-friendly — model bytes move in and
 * out without structured-clone copies where possible.
 */

import { convertModel } from '@/conversion/pipeline';
import { toModelError } from '@/core/errors';
import type { WorkerRequest, WorkerResponse } from '@/core/messaging/types';

const cancelled = new Set<string>();

/** Minimal dedicated-worker scope (avoids DOM/WebWorker lib conflicts). */
const ctx = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => {
  ctx.postMessage(msg, transfer);
};

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'CANCEL') {
    cancelled.add(msg.jobId);
    return;
  }
  if (msg.type !== 'CONVERT') return;

  const { jobId, source, format, includeTextures, textures, basename } = msg;
  try {
    const result = await convertModel({
      source,
      format,
      includeTextures,
      // Panel already sniffed mime types; textures pass through verbatim.
      textures: textures.map((t) => ({ ...t })),
      basename,
      onStage: (stage, detail, progress) => post({ type: 'STAGE', jobId, stage, detail, progress }),
      shouldCancel: () => cancelled.has(jobId),
    });
    if (cancelled.has(jobId)) {
      cancelled.delete(jobId);
      post({ type: 'FAILED', jobId, code: 'CANCELLED', message: 'The operation was cancelled.' });
      return;
    }
    cancelled.delete(jobId);
    post(
      {
        type: 'DONE',
        jobId,
        format: result.format,
        filename: result.filename,
        data: result.data,
        mimeType: result.mimeType,
        packaged: result.packaged,
        files: result.files,
        warnings: result.warnings,
        stats: result.stats!,
      },
      [result.data],
    );
  } catch (e) {
    const err = toModelError(e);
    post({ type: 'FAILED', jobId, code: err.code, message: err.userMessage, detail: err.detail });
  }
};
