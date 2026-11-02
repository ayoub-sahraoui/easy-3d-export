/** Meshy provider: recognition, normalization, rootId grouping, preferences. */

import { describe, expect, it } from 'vitest';
import { meshyPlugin } from '@/plugins/meshy';
import {
  generateTaskFixture,
  textureTaskFixture,
  unrelatedFixtures,
} from '@/plugins/meshy/fixtures';
import { pluginRegistry } from '@/plugins/registry';
import { isMeshyEndpoint } from '@/plugins/meshy/urls';

const ROOT = '01a19917-3282-7356-9701-19ef84fb129c';

describe('meshy recognition', () => {
  it('recognizes the generate fixture', () => {
    expect(meshyPlugin.recognizesPayload(generateTaskFixture)).toBe(true);
  });
  it('recognizes the texture fixture', () => {
    expect(meshyPlugin.recognizesPayload(textureTaskFixture)).toBe(true);
  });
  it('recognizes a bare task without envelope', () => {
    expect(meshyPlugin.recognizesPayload(generateTaskFixture.result)).toBe(true);
  });
  it('rejects unrelated JSON', () => {
    for (const fixture of unrelatedFixtures) {
      expect(meshyPlugin.recognizesPayload(fixture)).toBe(false);
    }
  });
  it('rejects malformed JSON values', () => {
    expect(meshyPlugin.recognizesPayload(undefined)).toBe(false);
    expect(meshyPlugin.recognizesPayload('{"code":"OK"')).toBe(false);
  });
});

describe('meshy normalization', () => {
  it('maps a generate task to a model variant', () => {
    const model = meshyPlugin.normalize(generateTaskFixture);
    expect(model).not.toBeNull();
    expect(model!.id).toBe(ROOT);
    expect(model!.name).toBe('Green Stripe SUV');
    expect(model!.status).toBe('succeeded'); // SUCCEEDED outranks progress:0
    expect(model!.variants).toHaveLength(1);
    const variant = model!.variants[0]!;
    expect(variant.kind).toBe('generated');
    expect(variant.sourceTaskId).toBe('01a19917-3282-7356-9701-19ef84fb129c');
    const modelAsset = variant.assets.find((a) => a.kind === 'model');
    expect(modelAsset?.format).toBe('meshy');
    expect(modelAsset?.url).toContain('01a19917-generate.model.meshy');
    // autoTexture:true is a request option — must NOT fabricate texture assets
    expect(variant.textures).toHaveLength(0);
  });

  it('maps a texture task with textureUrls', () => {
    const model = meshyPlugin.normalize(textureTaskFixture);
    const variant = model!.variants[0]!;
    expect(variant.kind).toBe('textured');
    expect(variant.id).toContain('01a19917-5757-7058-a6a3-a3f9ecce3525');
    expect(variant.textures).toHaveLength(1);
    expect(variant.textures[0]!.role).toBe('baseColor');
    expect(variant.textures[0]!.url).toContain('texture_0.png');
    // texture task reports 2775 vertices, same 2488 triangles
    expect(variant.triangles).toBe(2488);
    expect(variant.vertices).toBe(2775);
  });

  it('carries provenance', () => {
    const model = meshyPlugin.normalize(textureTaskFixture, {
      source: 'network-response',
      url: 'https://www.meshy.ai/x',
      detectedAt: 123,
    });
    expect(model!.provenance).toEqual({ source: 'network-response', url: 'https://www.meshy.ai/x', detectedAt: 123 });
  });
});

describe('rootId grouping', () => {
  it('merges generation + texture tasks into one model with two variants', async () => {
    const generated = meshyPlugin.normalize(generateTaskFixture)!;
    const textured = meshyPlugin.normalize(textureTaskFixture)!;
    expect(generated.id).toBe(textured.id); // same rootId → same group

    const merged = meshyPlugin.mergeTask(generated, textured);
    expect(merged.variants).toHaveLength(2);
    expect(merged.variants.map((v) => v.kind)).toEqual(['textured', 'generated']);
    expect(merged.status).toBe('succeeded');
  });

  it('prefers the latest successful textured variant', async () => {
    const generated = meshyPlugin.normalize(generateTaskFixture)!;
    const textured = meshyPlugin.normalize(textureTaskFixture)!;
    const merged = meshyPlugin.mergeTask(generated, textured);
    const preferred = meshyPlugin.preferVariant(merged);
    expect(preferred?.kind).toBe('textured');
  });

  it('still selects a generated variant when texturing failed', () => {
    const generated = meshyPlugin.normalize(generateTaskFixture)!;
    const failedTexture = meshyPlugin.normalize({
      ...textureTaskFixture,
      result: { ...textureTaskFixture.result, status: 'FAILED' },
    })!;
    const merged = meshyPlugin.mergeTask(generated, failedTexture);
    expect(merged.status).toBe('succeeded'); // geometry task still succeeded
    const preferred = meshyPlugin.preferVariant(merged);
    expect(preferred?.kind).toBe('generated');
  });

  it('replaces a variant when the same task updates', () => {
    const processing = meshyPlugin.normalize({
      ...generateTaskFixture,
      result: { ...generateTaskFixture.result, status: 'RUNNING' },
    })!;
    const done = meshyPlugin.normalize(generateTaskFixture)!;
    const merged = meshyPlugin.mergeTask(processing, done);
    expect(merged.variants).toHaveLength(1);
    expect(merged.variants[0]!.status).toBe('succeeded');
    expect(merged.status).toBe('succeeded');
  });

  it('marks a model processing while the only task runs', () => {
    const processing = meshyPlugin.normalize({
      ...generateTaskFixture,
      result: {
        ...generateTaskFixture.result,
        status: 'RUNNING',
        result: { previewUrl: undefined, generate: null, texture: null },
      },
    })!;
    expect(processing.status).toBe('processing');
    expect(processing.variants[0]!.assets.filter((a) => a.kind === 'model')).toHaveLength(0);
  });
});

describe('asset resolution', () => {
  it('fills filenames and signed-URL expiry, drops unsafe URLs', async () => {
    const textured = meshyPlugin.normalize(textureTaskFixture)!;
    const resolved = await meshyPlugin.resolveAssets(textured);
    const asset = resolved.variants[0]!.assets.find((a) => a.kind === 'model')!;
    expect(asset.filename).toBe('01a19917-textured.model.meshy');
    expect(asset.expiresAt).toBe(1793664000 * 1000);
    const texture = resolved.variants[0]!.textures[0]!;
    expect(texture.filename).toBe('01a19917-texture_0.png');
  });

  it('drops non-https asset URLs as untrusted', async () => {
    const model = meshyPlugin.normalize({
      ...generateTaskFixture,
      result: {
        ...generateTaskFixture.result,
        result: {
          ...generateTaskFixture.result.result,
          generate: {
            modelUrl: 'http://insecure.example/model.meshy',
            quadJsonUrl: 'file:///etc/passwd',
          },
        },
      },
    })!;
    const resolved = await meshyPlugin.resolveAssets(model);
    const variant = resolved.variants[0]!;
    expect(variant.assets.find((a) => a.kind === 'model')!.url).toBeUndefined();
    expect(variant.assets.find((a) => a.kind === 'geometry')!.url).toBeUndefined();
  });
});

describe('provider registry', () => {
  it('routes meshy.ai URLs to the meshy provider', () => {
    expect(pluginRegistry.forUrl(new URL('https://www.meshy.ai/studio'))?.id).toBe('meshy');
    expect(pluginRegistry.forUrl(new URL('https://meshy.ai/3d-models/x'))?.id).toBe('meshy');
    // api.meshy.ai serves the signed assets — it must be a provider origin.
    expect(pluginRegistry.forUrl(new URL('https://api.meshy.ai/misc/cdn-models/x/tasks/y'))?.id).toBe('meshy');
    expect(pluginRegistry.forUrl(new URL('https://example.com'))).toBeUndefined();
  });
  it('registers the two working plugins with enabled defaults', () => {
    const rodin = pluginRegistry.get('rodin')!;
    expect(rodin.capabilities.automaticDetection).toBe(true);
    expect(pluginRegistry.all().map((plugin) => [plugin.id, plugin.defaultEnabled])).toEqual([['meshy', true], ['rodin', true]]);
    expect(rodin.recognizesPayload({ whatever: true })).toBe(false);
    expect(rodin.normalize({})).toBeNull();
  });
});

describe('meshy endpoint allowlist', () => {
  const allows = (url: string) => isMeshyEndpoint(new URL(url));

  it('allows task endpoints on meshy hosts incl. api.meshy.ai', () => {
    expect(allows('https://www.meshy.ai/meshyd-api/web/public/v2/tasks/abc')).toBe(true);
    expect(allows('https://api.meshy.ai/misc/cdn-models/m/tasks/t/output/model.meshy?sign=1-x')).toBe(true);
    expect(allows('https://api.meshy.ai/tasks/t')).toBe(true);
  });
  it('rejects other hosts and non-task paths', () => {
    expect(allows('https://evil.example.com/tasks/x')).toBe(false);
    expect(allows('https://api.meshy.ai/unrelated/endpoint')).toBe(false);
    expect(allows('https://meshy.ai/blog')).toBe(false);
  });
});
