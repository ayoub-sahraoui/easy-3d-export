import { beforeEach, expect, it, vi } from 'vitest';
import { runConversion } from '@/features/conversion/conversion-service';
import type { WorkerRequest, WorkerResponse } from '@/core/messaging/types';

vi.mock('@/downloads/manager', () => ({
  fetchAssetWithPermission: vi.fn(), saveBytesOnce: vi.fn().mockResolvedValue(1), cancelFetch: vi.fn(),
}));
vi.mock('@/features/conversion/verify', () => ({ verifyGlbWithThree: vi.fn().mockResolvedValue({ meshes: 1 }) }));
const captured = vi.hoisted(() => [] as number[][]);
vi.mock('@/features/conversion/worker-client', () => ({
  createConversionClient: () => {
    const client = {
      onMessage: null as ((message: WorkerResponse) => void) | null,
      cancel: vi.fn(), terminate: vi.fn(),
      convert(request: WorkerRequest & { type: 'CONVERT' }, transfer: ArrayBuffer[]) {
        const copy = structuredClone(request, { transfer });
        captured.push([...new Uint8Array(copy.source.bytes)]);
        queueMicrotask(() => client.onMessage?.({
          type: 'DONE', jobId: copy.jobId, filename: 'model.glb', data: copy.source.bytes,
          format: 'glb', mimeType: 'model/gltf-binary', packaged: false, files: [], warnings: [],
          stats: { meshCount: 1, triangles: 1, vertices: 3, hasNormals: false, hasUvs: false, hasTextures: false, materials: 0 },
        }));
      },
    };
    return client;
  },
}));
beforeEach(() => { captured.length = 0; });

it('keeps local model and texture buffers usable for repeated exports', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const texture = new Uint8Array([5, 6, 7, 8]).buffer;
  const target = {
    model: null, variant: undefined, format: 'glb' as const, includeTextures: true, basename: 'model',
    localSource: { name: 'model.glb', bytes },
    localTextures: [{ name: 'color.png', bytes: texture, mimeType: 'image/png' }],
  };
  const callbacks = { onStage: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  await runConversion(target, callbacks);
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(bytes.byteLength).toBe(4);
  expect(texture.byteLength).toBe(4);
  await runConversion(target, callbacks);
  expect(captured).toEqual([[1, 2, 3, 4], [1, 2, 3, 4]]);
  expect(callbacks.onDone).toHaveBeenCalledTimes(2);
});
