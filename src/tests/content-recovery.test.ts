// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { observeProviderPage } from '@/features/detection/content-observer';

const mock = vi.hoisted(() => ({ sendMessage: vi.fn().mockResolvedValue({ type: 'ACK' }), listeners: [] as ((message: unknown) => void)[] }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mock.sendMessage, onMessage: { addListener: (fn: (message: unknown) => void) => mock.listeners.push(fn) } } } }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (definition: unknown) => definition }));

it('replays observed model responses when a restarted background requests a rescan', async () => {
  observeProviderPage('meshy');
  const payload = { result: { id: 'model-1', status: 'SUCCEEDED' } };
  window.dispatchEvent(new CustomEvent('modelport:bridge', { detail: {
    bridge: 'modelport', version: 1, kind: 'response',
    url: 'https://www.meshy.ai/meshyd-api/tasks/model-1', bodyText: JSON.stringify(payload),
  } }));
  await Promise.resolve();
  expect(mock.sendMessage.mock.calls.filter(([msg]) => msg.type === 'MODEL_PAYLOAD_DETECTED')).toHaveLength(1);
  mock.listeners[0]!({ type: 'SCAN_PAGE' });
  await Promise.resolve();
  expect(mock.sendMessage.mock.calls.filter(([msg]) => msg.type === 'MODEL_PAYLOAD_DETECTED')).toHaveLength(2);
});
