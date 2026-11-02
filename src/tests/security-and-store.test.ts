import { meshyUuidFromPageUrl } from '@/plugins/meshy/urls';
/** URL security, signed-URL handling, filenames, errors, tab store. */

import { describe, expect, it } from 'vitest';
import {
  isSafeAssetUrl,
  parseSignedUrlExpiry,
  redactUrlForDisplay,
  validateAssetUrl,
} from '@/core/security/url';
import { downloadFilename, sanitizeFilename } from '@/downloads/filenames';
import { ModelError, redactUrls, toModelError } from '@/core/errors';
import { TabStore } from '@/core/background/tab-store';
import { meshyPlugin } from '@/plugins/meshy';
import { generateTaskFixture, textureTaskFixture } from '@/plugins/meshy/fixtures';

describe('asset URL validation', () => {
  it('accepts ordinary https asset URLs', () => {
    expect(isSafeAssetUrl('https://cdn.example.com/model.meshy?sign=123-abc')).toBe(true);
  });
  it('rejects http, credentials, localhost, IPs and junk', () => {
    for (const bad of [
      'http://cdn.example.com/x',
      'https://user:pass@cdn.example.com/x',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://127.0.0.1:8080/x',
      'file:///etc/passwd',
      'not a url',
      'https://',
    ]) {
      expect(isSafeAssetUrl(bad)).toBe(false);
    }
  });
  it('returns the parsed URL on success', () => {
    expect(validateAssetUrl('https://example.com/a.png').hostname).toBe('example.com');
  });
});

describe('signed URL expiry', () => {
  it('parses meshy-style sign=unixseconds tokens', () => {
    expect(parseSignedUrlExpiry('https://cdn.x/m.meshy?sign=1793664000-deadbeef')).toBe(1793664000 * 1000);
  });
  it('parses epoch-ms style tokens', () => {
    expect(parseSignedUrlExpiry('https://cdn.x/m.meshy?sign=1793664000000-abc')).toBe(1793664000000);
  });
  it('returns undefined for unknown schemes', () => {
    expect(parseSignedUrlExpiry('https://cdn.x/m.meshy')).toBeUndefined();
    expect(parseSignedUrlExpiry(undefined)).toBeUndefined();
  });
});

describe('url redaction', () => {
  it('strips query strings for display and logs', () => {
    const signed = 'https://cdn.example.com/model.meshy?sign=1793664000-secret';
    expect(redactUrlForDisplay(signed)).toBe('https://cdn.example.com/model.meshy?…');
    expect(redactUrls(`failed ${signed}`)).not.toContain('secret');
  });
});

describe('meshy page URLs', () => {
  it('extracts the task uuid from a model page URL', () => {
    expect(meshyUuidFromPageUrl('https://www.meshy.ai/3d-models/green-stripe-suv-01a19917-3282-7356-9701-19ef84fb129c')).toBe(
      '01a19917-3282-7356-9701-19ef84fb129c',
    );
    expect(meshyUuidFromPageUrl('https://www.meshy.ai/studio')).toBeNull();
    expect(meshyUuidFromPageUrl('https://example.com/3d-models/x')).toBeNull();
  });
});

describe('filenames', () => {
  it('sanitizes traversal and control characters', () => {
    const pathy = sanitizeFilename('../../etc/passwd');
    expect(pathy).not.toContain('/');
    expect(pathy.startsWith('.')).toBe(false);
    expect(sanitizeFilename('con <boot>: "disk"|?*.bin')).not.toMatch(/[<>:"|?*]/);
    expect(sanitizeFilename('   ')).toBe('model');
    expect(sanitizeFilename('x'.repeat(300))).toHaveLength(120);
    expect(downloadFilename('Green Stripe SUV', 'glb')).toBe('Green Stripe SUV.glb');
  });
});

describe('errors', () => {
  it('maps abort errors to CANCELLED', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(toModelError(abort).code).toBe('CANCELLED');
  });
  it('keeps user messages clean and redacts details', () => {
    const err = new Error('boom https://x.com/t?sign=1-zzz');
    const mapped = toModelError(err, 'ASSET_DOWNLOAD_FAILED');
    expect(mapped.userMessage).not.toContain('boom');
    expect(mapped.detail).not.toContain('zzz');
  });
  it('exposes stable codes', () => {
    expect(new ModelError('ASSET_URL_EXPIRED').code).toBe('ASSET_URL_EXPIRED');
  });
});

describe('tab store grouping', () => {
  it('keeps models per tab and merges tasks by rootId', async () => {
    const store = new TabStore();
    const generated = meshyPlugin.normalize(generateTaskFixture)!;
    const textured = meshyPlugin.normalize(textureTaskFixture)!;
    await store.upsertModel(1, generated);
    await store.upsertModel(1, textured);
    await store.upsertModel(2, generated);

    expect(store.listModels(1)).toHaveLength(1); // grouped under rootId
    expect(store.listModels(1)[0]!.variants).toHaveLength(2);
    expect(store.listModels(2)).toHaveLength(1);
    expect(store.listModels(1)[0]!.variants[0]!.kind).toBe('textured'); // preferred order
    expect(store.listModels(3)).toHaveLength(0);
  });

  it('resets models on navigation and deletes closed tabs', async () => {
    const store = new TabStore();
    await store.upsertModel(7, meshyPlugin.normalize(generateTaskFixture)!);
    store.resetModels(7);
    expect(store.listModels(7)).toHaveLength(0);
    expect(store.get(7)?.observing).toBe(false);
    store.delete(7);
    expect(store.get(7)).toBeUndefined();
  });

  it('follows the current Meshy model page when SPA navigation changes the URL', async () => {
    const store = new TabStore();
    const first = meshyPlugin.normalize(generateTaskFixture)!;
    const secondId = '01a19917-3282-7356-9701-19ef84fb129d';
    const second = { ...first, id: secondId, rootId: secondId };
    await store.upsertModel(1, first);
    await store.upsertModel(1, second);
    store.noteUrl(1, `https://www.meshy.ai/3d-models/new-model-${secondId}`);
    expect(store.listModels(1).map((model) => model.id)).toEqual([secondId]);
    store.noteUrl(1, 'https://www.meshy.ai/3d-models/01a19917-3282-7356-9701-19ef84fb129e');
    expect(store.listModels(1)).toEqual([]);
  });
});
