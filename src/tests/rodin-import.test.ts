// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setPluginEnabled } from '@/plugins/preferences';
import { importFromUrl, importJsonText, importLocalFiles } from '@/features/import/manual-import';
import { fetchAssetWithPermission } from '@/downloads/manager';
import { rodinTaskFixture } from '@/plugins/rodin/fixtures';
import { usePanelStore } from '@/stores/panel-store';

vi.mock('@/downloads/manager', () => ({ fetchAssetWithPermission: vi.fn() }));
beforeEach(() => fakeBrowser.reset());
afterEach(() => { usePanelStore.setState({ manualModels: [], localImport: undefined }); vi.clearAllMocks(); });

it('imports the real Rodin task-card shape through the shared JSON importer', async () => {
  const model = await importJsonText(JSON.stringify(rodinTaskFixture));
  expect(model.provider).toBe('rodin');
  expect(usePanelStore.getState().manualModels).toHaveLength(1);
});

it('resolves a public Rodin workspace URL with an anonymous task-card POST', async () => {
  vi.mocked(fetchAssetWithPermission).mockResolvedValue(new TextEncoder().encode(JSON.stringify(rodinTaskFixture)).buffer);
  await importFromUrl(`https://hyper3d.ai/workspace/rodin/${rodinTaskFixture.task_uuid}`);
  expect(fetchAssetWithPermission).toHaveBeenCalledWith(
    `https://api.hyper3d.com/api/task/card/${rodinTaskFixture.task_uuid}`,
    `import:rodin:${rodinTaskFixture.task_uuid}`, undefined,
    { method: 'POST', body: '{}', maxBytes: 2 * 1024 * 1024 },
  );
  expect(usePanelStore.getState().manualModels[0]!.provider).toBe('rodin');
});

it('accepts a standalone local .drc file', async () => {
  await setPluginEnabled('rodin', false);
  const bytes = new Uint8Array([68,82,65,67,79,2,2,1]).buffer;
  const file = { name: 'model.drc', arrayBuffer: async () => bytes } as File;
  await importLocalFiles([file]);
  expect(usePanelStore.getState().localImport).toMatchObject({ name: 'model.drc', kind: 'drc', bytes });
});

it('blocks provider JSON and page imports before fetching when its plugin is disabled', async () => {
  await setPluginEnabled('rodin', false);
  await expect(importJsonText(JSON.stringify(rodinTaskFixture))).rejects.toThrow('Enable the Hyper3D Rodin plugin');
  await expect(importFromUrl(`https://hyper3d.ai/workspace/rodin/${rodinTaskFixture.task_uuid}`)).rejects.toThrow('Enable the Hyper3D Rodin plugin');
  expect(fetchAssetWithPermission).not.toHaveBeenCalled();
  expect(usePanelStore.getState().manualModels).toEqual([]);
});
