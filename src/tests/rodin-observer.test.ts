// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { observeProviderPage } from '@/features/detection/content-observer';
import { rodinTaskFixture } from '@/plugins/rodin/fixtures';
const mock = vi.hoisted(() => ({ sendMessage: vi.fn().mockResolvedValue({ type: 'ACK' }) }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: mock.sendMessage, onMessage: { addListener() {} } } } }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (definition: unknown) => definition }));

it('announces and forwards Rodin detections under the Rodin provider', () => {
  observeProviderPage('rodin');
  window.dispatchEvent(new CustomEvent('modelport:bridge', { detail: {
    bridge: 'modelport', version: 1, kind: 'response',
    url: `https://api.hyper3d.com/api/task/card/${rodinTaskFixture.task_uuid}`,
    bodyText: JSON.stringify(rodinTaskFixture),
  } }));
  expect(mock.sendMessage).toHaveBeenCalledWith({ type: 'CONTENT_READY', providerId: 'rodin' });
  expect(mock.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'MODEL_PAYLOAD_DETECTED', providerId: 'rodin', payload: rodinTaskFixture }));
});
