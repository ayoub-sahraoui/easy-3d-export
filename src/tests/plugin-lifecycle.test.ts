// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pluginRegistry } from '@/plugins/registry';
import { setPluginEnabled } from '@/plugins/preferences';
import { startPluginBridge } from '@/features/detection/plugin-bridge';
import { startPluginContent } from '@/features/detection/plugin-content';

const mock = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ type: 'ACK' }),
  listeners: new Set<(message: unknown) => void>(),
}));
vi.mock('wxt/browser', () => ({ browser: { runtime: {
  sendMessage: mock.sendMessage,
  onMessage: {
    addListener: (fn: (message: unknown) => void) => mock.listeners.add(fn),
    removeListener: (fn: (message: unknown) => void) => mock.listeners.delete(fn),
  },
} } }));

const cleanup: (() => void)[] = [];
let fetchOriginal: typeof fetch;
beforeEach(() => {
  fakeBrowser.reset(); mock.sendMessage.mockClear();
  fetchOriginal = window.fetch;
  window.fetch = vi.fn(async () => new Response(JSON.stringify({ result: { id: 'model-1' } }), {
    headers: { 'content-type': 'application/json' },
  }));
});
afterEach(() => { cleanup.splice(0).reverse().forEach((stop) => stop()); window.fetch = fetchOriginal; });

it.each(pluginRegistry.all())('$id stops detection and restores page fetch when disabled, then resumes without a reload', async (plugin) => {
  const pageFetch = window.fetch;
  const url = plugin.id === 'rodin'
    ? 'https://api.hyper3d.com/api/task/card/30f65e09-6af7-45c8-b03a-0e08b84f200a'
    : 'https://www.meshy.ai/meshyd-api/tasks/model-1';
  await setPluginEnabled(plugin.id, false);
  // Isolated-first also exercises the bridge-ready handshake.
  cleanup.push(startPluginContent(plugin));
  cleanup.push(startPluginBridge(plugin));
  await vi.waitFor(() => expect(window.fetch).toBe(pageFetch));
  await window.fetch(url);
  expect(mock.sendMessage).not.toHaveBeenCalled();

  await setPluginEnabled(plugin.id, true);
  await vi.waitFor(() => expect(mock.sendMessage).toHaveBeenCalledWith({ type: 'CONTENT_READY', providerId: plugin.id }));
  await window.fetch(url);
  await vi.waitFor(() => expect(mock.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'MODEL_PAYLOAD_DETECTED', providerId: plugin.id })));

  await setPluginEnabled(plugin.id, false);
  await vi.waitFor(() => expect(window.fetch).toBe(pageFetch));
  mock.sendMessage.mockClear();
  await window.fetch(url);
  window.dispatchEvent(new CustomEvent('modelport:bridge', { detail: {
    bridge: 'modelport', kind: 'response', url, bodyText: '{"id":"model-2"}',
  } }));
  expect(mock.listeners.size).toBe(0);
  expect(mock.sendMessage).not.toHaveBeenCalled();

  await setPluginEnabled(plugin.id, true);
  await vi.waitFor(() => expect(mock.listeners.size).toBe(1));
  expect(window.fetch).not.toBe(pageFetch);
});

it('does not emit a captured response that finishes reading after disable', async () => {
  let finish!: (text: string) => void;
  const body = new Promise<string>((resolve) => { finish = resolve; });
  window.fetch = vi.fn(async () => ({
    url: 'https://www.meshy.ai/meshyd-api/tasks/model-1', headers: new Headers({ 'content-type': 'application/json' }),
    clone: () => ({ text: () => body }),
  } as Response));
  const emit = vi.fn();
  window.addEventListener('modelport:bridge', emit);
  cleanup.push(() => window.removeEventListener('modelport:bridge', emit));
  cleanup.push(startPluginBridge(pluginRegistry.get('meshy')!));
  const control = (enabled: boolean) => window.dispatchEvent(new CustomEvent('modelport:plugin-control', { detail: { pluginId: 'meshy', enabled } }));
  control(true);
  await window.fetch('https://www.meshy.ai/meshyd-api/tasks/model-1');
  control(false);
  finish('{"id":"model-1"}');
  await body; await Promise.resolve();
  expect(emit).not.toHaveBeenCalled();
});
