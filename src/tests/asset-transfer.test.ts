import { afterEach, expect, it, vi } from 'vitest';
import { cancelFetch, fetchAsset } from '@/downloads/manager';

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      connect: () => ({ onMessage: { addListener() {}, removeListener() {} }, disconnect() {} }),
      // Chrome applies JSON serialization even when the background responds with an ArrayBuffer.
      sendMessage: async () => JSON.parse(JSON.stringify({
        type: 'FETCH_ASSET_RESULT', ok: true, bytes: new Uint8Array([0, 97, 115, 109]).buffer,
      })),
    },
  },
}));
afterEach(() => vi.unstubAllGlobals());

it('delivers binary asset bytes to the converter without JSON serialization', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 97, 115, 109]))));
  const bytes = await fetchAsset('https://api.meshy.ai/model.glb', { requestId: 'asset' });
  expect(bytes).toBeInstanceOf(ArrayBuffer);
  expect([...new Uint8Array(bytes)]).toEqual([0, 97, 115, 109]);
});

it('cancels an ongoing asset download in the panel', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  })));
  const pending = fetchAsset('https://api.meshy.ai/model.glb', { requestId: 'cancelled' });
  await cancelFetch('cancelled');
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
});
