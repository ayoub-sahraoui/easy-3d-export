import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '@/entrypoints/background';
import { setPluginEnabled } from '@/plugins/preferences';
import { rodinTaskFixture } from '@/plugins/rodin/fixtures';
import type { PanelRequestResponse } from '@/core/messaging/types';

let tabId: number;
beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.sidePanel, 'setPanelBehavior').mockResolvedValue();
  vi.spyOn(fakeBrowser.runtime.onConnect, 'addListener').mockImplementation(() => undefined);
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined);
  const tab = await fakeBrowser.tabs.create({ url: `https://hyper3d.ai/workspace/rodin/${rodinTaskFixture.task_uuid}`, active: true });
  tabId = tab.id!;
  background.main();
});
afterEach(() => vi.restoreAllMocks());

const snapshot = () => fakeBrowser.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId }) as Promise<Extract<PanelRequestResponse, { type: 'TAB_STATE' }>>;
async function detect(url = `https://hyper3d.ai/workspace/rodin/${rodinTaskFixture.task_uuid}`) {
  await fakeBrowser.runtime.onMessage.trigger({
    type: 'MODEL_PAYLOAD_DETECTED', providerId: 'rodin', payload: rodinTaskFixture,
    provenance: { source: 'network-response', url: 'https://api.hyper3d.com/api/task/card/example' },
  }, { tab: { ...await fakeBrowser.tabs.get(tabId), url } }, () => undefined);
}

it('rejects detections while disabled, hides prior detections, and restores them when enabled', async () => {
  await setPluginEnabled('rodin', false);
  await detect();
  expect(await snapshot()).toMatchObject({ supported: true, pluginEnabled: false, models: [], observing: false });
  await setPluginEnabled('rodin', true);
  await detect();
  await vi.waitFor(async () => expect((await snapshot()).models).toHaveLength(1));
  await setPluginEnabled('rodin', false);
  expect((await snapshot()).models).toEqual([]);
  await setPluginEnabled('rodin', true);
  expect((await snapshot()).models).toHaveLength(1);
});

it('rejects a claimed provider from an unrelated tab', async () => {
  await detect('https://unrelated.example/model');
  expect((await snapshot()).models).toEqual([]);
});
