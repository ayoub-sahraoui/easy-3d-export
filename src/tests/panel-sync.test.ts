// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBackgroundSync } from '@/hooks/use-background-sync';
import { usePanelStore } from '@/stores/panel-store';
import type { NormalizedModel } from '@/core/models/types';

const mock = vi.hoisted(() => {
  function event() {
    const listeners = new Set<(value?: unknown) => void>();
    return {
      addListener: vi.fn((listener) => listeners.add(listener)),
      removeListener: vi.fn((listener) => listeners.delete(listener)),
      emit: (value?: unknown) => { for (const listener of [...listeners]) listener(value); },
    };
  }
  return { event, connect: vi.fn(), sendMessage: vi.fn(), activated: event(), updated: event() };
});
vi.mock('wxt/browser', () => ({
  browser: { runtime: { connect: mock.connect, sendMessage: mock.sendMessage }, tabs: { onActivated: mock.activated, onUpdated: mock.updated } },
}));

const model: NormalizedModel = { id: 'new-model', name: 'Detected model', provider: 'meshy', status: 'succeeded', variants: [] };
const snapshot = { type: 'TAB_STATE', tabId: 1, supported: true, providerId: 'meshy', models: [], observing: true };
let root: Root;
let container: HTMLDivElement;
let ports: ReturnType<typeof makePort>[];
function makePort() { return { onMessage: mock.event(), onDisconnect: mock.event(), disconnect: vi.fn() }; }
function Harness() { useBackgroundSync(); return null; }
async function mount() { await act(async () => { root.render(createElement(Harness)); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  ports = [];
  mock.connect.mockImplementation(() => { const port = makePort(); ports.push(port); return port; });
  mock.sendMessage.mockResolvedValue(snapshot);
  usePanelStore.setState({ activeTabId: undefined, localImport: undefined, manualModels: [], models: [], providerId: undefined });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reconnects a disconnected panel and receives models without reopening it', async () => {
  await mount();
  ports[0]!.onDisconnect.emit();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(mock.connect).toHaveBeenCalledTimes(2);
  await act(async () => { ports[1]!.onMessage.emit({ type: 'TAB_MODELS_UPDATED', tabId: 1, providerId: 'meshy', models: [model], observing: true }); });
  expect(usePanelStore.getState().models).toEqual([model]);
});

it('does not let an older request erase a newer pushed model', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  mock.sendMessage.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  window.dispatchEvent(new Event('focus'));
  await act(async () => { ports[0]!.onMessage.emit({ type: 'TAB_MODELS_UPDATED', tabId: 1, providerId: 'meshy', models: [model], observing: true }); });
  await act(async () => { resolve(snapshot); });
  expect(usePanelStore.getState().models).toEqual([model]);
});

it('refreshes the current model when the panel regains focus', async () => {
  await mount();
  mock.sendMessage.mockResolvedValue({ ...snapshot, models: [model] });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(usePanelStore.getState().models).toEqual([model]);
});

it('keeps the selected manual model when tab state refreshes', () => {
  usePanelStore.setState({ manualModels: [model], selectedModelId: model.id, selectedVariantId: 'manual-variant' });
  usePanelStore.getState().applyTabState({ tabId: 1, supported: true, providerId: 'meshy', models: [], observing: true });
  expect(usePanelStore.getState().selectedModelId).toBe(model.id);
  expect(usePanelStore.getState().selectedVariantId).toBe('manual-variant');
});
