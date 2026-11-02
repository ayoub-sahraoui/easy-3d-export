// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversionControls } from '@/components/conversion/ConversionControls';
import { useConversionActions } from '@/features/conversion/use-conversion-actions';
import { usePanelStore } from '@/stores/panel-store';
import { downloadUrlToDisk, saveBytesOnce } from '@/downloads/manager';
import type { NormalizedModel } from '@/core/models/types';

vi.mock('@/downloads/manager', () => ({
  downloadUrlToDisk: vi.fn().mockResolvedValue(undefined),
  saveBytesOnce: vi.fn().mockResolvedValue(undefined),
  fetchAssetWithPermission: vi.fn(),
}));
vi.mock('@/features/conversion/conversion-service', () => ({ cancelActiveConversion: vi.fn(), runConversion: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const model: NormalizedModel = {
  id: 'manual', provider: 'meshy', name: 'Imported model', status: 'succeeded',
  variants: [{ id: 'textured', label: 'Textured model', kind: 'textured', status: 'succeeded', assets: [], textures: [
    { id: 'color', role: 'baseColor', url: 'https://cdn.example.com/color.png', filename: 'color.png' },
    { id: 'normal', role: 'normal', url: 'https://cdn.example.com/normal.png', filename: 'normal.png' },
  ] }],
};
let root: Root;
let container: HTMLDivElement;
let actions: ReturnType<typeof useConversionActions>;
function Harness() { actions = useConversionActions(); return createElement(ConversionControls, { busy: false, onDownloadAll: () => undefined }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  usePanelStore.setState({ models: [], manualModels: [model], providerId: undefined, selectedModelId: model.id, selectedVariantId: 'textured', localImport: undefined, format: 'glb', job: undefined });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(createElement(Harness)); }); }

it('offers every supported export for a manual model on an unsupported tab', async () => {
  await mount();
  expect([...container.querySelectorAll('[role=tab]')].map(tab => tab.textContent)).toEqual(['Original', 'GLB', 'OBJ']);
  await act(async () => { usePanelStore.getState().setFormat('obj'); });
  expect(container.querySelector('[role=tab][data-state=active]')?.textContent).toBe('OBJ');
});

it('downloads every texture from the selected variant', async () => {
  await mount();
  await actions.downloadTextures();
  expect(downloadUrlToDisk).toHaveBeenCalledTimes(2);
  expect(downloadUrlToDisk).toHaveBeenCalledWith('https://cdn.example.com/color.png', 'color.png');
  expect(downloadUrlToDisk).toHaveBeenCalledWith('https://cdn.example.com/normal.png', 'normal.png');
});

it('saves local texture bytes without needing texture URLs', async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  usePanelStore.setState({ localImport: { name: 'model.glb', bytes, kind: 'glb', textures: [
    { name: 'color.png', bytes, mimeType: 'image/png' }, { name: 'normal.png', bytes, mimeType: 'image/png' },
  ] } });
  await mount();
  await actions.downloadTextures();
  expect(saveBytesOnce).toHaveBeenCalledTimes(2);
  expect(saveBytesOnce).toHaveBeenCalledWith(bytes, 'color.png', 'image/png');
  expect(saveBytesOnce).toHaveBeenCalledWith(bytes, 'normal.png', 'image/png');
  expect(downloadUrlToDisk).not.toHaveBeenCalled();
});
