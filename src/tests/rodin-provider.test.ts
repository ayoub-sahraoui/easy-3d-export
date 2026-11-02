import { describe, expect, it } from 'vitest';
import { rodinPlugin } from '@/plugins/rodin';
import { rodinTaskFixture } from '@/plugins/rodin/fixtures';
import { isRodinEndpoint, rodinUuidFromPageUrl } from '@/plugins/rodin/urls';
import { parseSignedUrlExpiry } from '@/core/security/url';
import { TabStore } from '@/core/background/tab-store';

describe('Rodin task cards', () => {
  it('normalizes the verified preview geometry without retaining account data', () => {
    const model = rodinPlugin.normalize({ ...rodinTaskFixture, author: { email: 'private@example.invalid' } })!;
    expect(rodinPlugin.recognizesPayload(rodinTaskFixture)).toBe(true);
    expect(model).toMatchObject({ provider: 'rodin', id: rodinTaskFixture.task_uuid, status: 'succeeded' });
    expect(model.variants[0]!.assets.find((asset) => asset.kind === 'model')).toMatchObject({
      format: 'drc', filename: `Rodin_${rodinTaskFixture.task_uuid}.drc`,
      expiresAt: Date.parse('2026-11-09T02:40:06Z'),
    });
    expect(model.variants[0]!.textures).toEqual([]);
    expect(JSON.stringify(model)).not.toContain('private@example.invalid');
    expect(JSON.stringify(model)).not.toContain('author');
  });

  it('rejects unrelated JSON and invalid task identifiers', () => {
    for (const payload of [{}, null, { ...rodinTaskFixture, type: 'Other' }, { ...rodinTaskFixture, task_uuid: '../not-a-task' }]) {
      expect(rodinPlugin.recognizesPayload(payload)).toBe(false);
      expect(rodinPlugin.normalize(payload)).toBeNull();
    }
  });

  it('never treats missing or unsafe preview links as downloadable models', () => {
    for (const preview_sdf of ['FILE_NOT_FOUND', 'http://file.hyper3d.com/model.drc', 'https://localhost/model.drc', 'https://file.hyper3d.com/preview.webp']) {
      const model = rodinPlugin.normalize({ ...rodinTaskFixture, model_preview_info: { preview_sdf } })!;
      expect(model.variants[0]!.assets.filter((asset) => asset.kind === 'model')).toEqual([]);
    }
  });

  it('updates the original task with refreshed signed links', () => {
    const first = rodinPlugin.normalize(rodinTaskFixture)!;
    const second = rodinPlugin.normalize({
      ...rodinTaskFixture, model_preview_info: { preview_sdf: rodinTaskFixture.model_preview_info.preview_sdf + '&refresh=1' },
    })!;
    expect(rodinPlugin.mergeTask(first, second).variants[0]!.assets[0]!.url).toContain('refresh=1');
  });

  it('restricts automatic response observation to the verified task-card endpoint', () => {
    const allowed = (url: string) => isRodinEndpoint(new URL(url));
    expect(allowed(`https://api.hyper3d.com/api/task/card/${rodinTaskFixture.task_uuid}`)).toBe(true);
    for (const url of ['https://api.hyper3d.com/api/user/me', 'https://api.hyper3d.com/api/task/rodin_unlock', 'https://evil.example/api/task/card/' + rodinTaskFixture.task_uuid]) {
      expect(allowed(url)).toBe(false);
    }
  });

  it('parses only Rodin workspace URLs and scopes tab models to their task', async () => {
    const page = `https://hyper3d.ai/workspace/rodin/${rodinTaskFixture.task_uuid}`;
    expect(rodinUuidFromPageUrl(page)).toBe(rodinTaskFixture.task_uuid);
    expect(rodinUuidFromPageUrl(page.replace('hyper3d.ai', 'evil.example'))).toBeNull();
    expect(rodinUuidFromPageUrl(page.replace('https:', 'http:'))).toBeNull();
    const store = new TabStore();
    await store.upsertModel(1, rodinPlugin.normalize(rodinTaskFixture)!);
    store.noteUrl(1, page);
    expect(store.listModels(1)).toHaveLength(1);
    store.noteUrl(1, page.replace(rodinTaskFixture.task_uuid, '30f65e09-6af7-45c8-b03a-0e08b84f200b'));
    expect(store.listModels(1)).toHaveLength(0);
  });

  it('recognizes TOS expiry without needing a signing credential', () => {
    expect(parseSignedUrlExpiry(rodinTaskFixture.model_preview_info.preview_sdf)).toBe(Date.parse('2026-11-09T02:40:06Z'));
    expect(parseSignedUrlExpiry('https://file.hyper3d.com/model.drc?X-Tos-Date=bad&X-Tos-Expires=604800')).toBeUndefined();
  });
});
