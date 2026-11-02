/** Conversion worker client: spawn per job, forward typed messages. */

import type { WorkerRequest, WorkerResponse } from '@/core/messaging/types';

export interface ConversionClient {
  convert(request: WorkerRequest & { type: 'CONVERT' }, transfer: ArrayBuffer[]): void;
  cancel(jobId: string): void;
  terminate(): void;
  onMessage: ((msg: WorkerResponse) => void) | null;
}

export function createConversionClient(): ConversionClient {
  const worker = new Worker(
    new URL('../../conversion/workers/conversion.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const client: ConversionClient = {
    onMessage: null,
    convert(request, transfer) {
      worker.postMessage(request, transfer);
    },
    cancel(jobId) {
      worker.postMessage({ type: 'CANCEL', jobId });
    },
    terminate() {
      worker.terminate();
    },
  };
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    client.onMessage?.(event.data);
  };
  return client;
}
