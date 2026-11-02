import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isPluginEnabled, readPluginPreferences, setPluginEnabled, watchPluginPreferences } from '@/plugins/preferences';

beforeEach(() => fakeBrowser.reset());

it('enables both bundled plugins by default and preserves a saved false value', async () => {
  expect(await readPluginPreferences()).toEqual({ meshy: true, rodin: true });
  await setPluginEnabled('rodin', false);
  expect(await readPluginPreferences()).toEqual({ meshy: true, rodin: false });
  expect(await isPluginEnabled('unknown')).toBe(false);
});

it('keeps independent plugin changes and reports live changes until unsubscribed', async () => {
  const changed = vi.fn();
  const stop = watchPluginPreferences(changed);
  await Promise.all([setPluginEnabled('meshy', false), setPluginEnabled('rodin', false)]);
  expect(await readPluginPreferences()).toEqual({ meshy: false, rodin: false });
  expect(changed).toHaveBeenCalledWith('meshy');
  expect(changed).toHaveBeenCalledWith('rodin');
  stop(); changed.mockClear();
  await setPluginEnabled('meshy', true);
  expect(changed).not.toHaveBeenCalled();
});

it('falls back to the plugin default for malformed saved values', async () => {
  await fakeBrowser.storage.local.set({ 'plugin:meshy:enabled': 'false' });
  expect(await isPluginEnabled('meshy')).toBe(true);
});
