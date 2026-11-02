// @vitest-environment happy-dom
/** Page-scan candidates (needs a DOM). */

import { describe, expect, it } from 'vitest';
import { payloadSignature, scanDocument } from '@/features/detection/page-scan';
import { generateTaskFixture, textureTaskFixture } from '@/plugins/meshy/fixtures';

function docWith(body: string, contentType = 'text/html'): Document {
  const doc = document.implementation.createHTMLDocument('test');
  if (contentType === 'application/json') {
    const pre = doc.createElement('pre');
    pre.textContent = body;
    doc.body.appendChild(pre);
    Object.defineProperty(doc, 'contentType', { value: contentType });
  } else {
    const script = doc.createElement('script');
    script.type = 'application/json';
    script.textContent = body;
    doc.body.appendChild(script);
  }
  return doc;
}

describe('page scan', () => {
  it('finds raw JSON documents', () => {
    const doc = docWith(JSON.stringify(generateTaskFixture), 'application/json');
    const candidates = scanDocument(doc, 'https://www.meshy.ai/api/tasks/1');
    expect(candidates).toHaveLength(1);
    expect((candidates[0]!.payload as { code: string }).code).toBe('OK');
    expect(candidates[0]!.source).toBe('json-document');
  });

  it('finds embedded JSON script tags', () => {
    const doc = docWith(JSON.stringify(textureTaskFixture));
    const candidates = scanDocument(doc, 'https://www.meshy.ai/x');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.source).toBe('page-scan');
  });

  it('ignores non-JSON and non-object content', () => {
    const doc = docWith('just text, not json');
    expect(scanDocument(doc, 'https://www.meshy.ai/x')).toHaveLength(0);
  });

  it('ignores oversized payloads', () => {
    const doc = docWith(`{"pad":"${'x'.repeat(600_000)}"}`);
    expect(scanDocument(doc, 'https://www.meshy.ai/x')).toHaveLength(0);
  });

  it('dedupes repeated payloads by signature', () => {
    const url = 'https://www.meshy.ai/api/tasks/1';
    const a = payloadSignature(generateTaskFixture, url);
    const again = payloadSignature(generateTaskFixture, url);
    const changed = payloadSignature(
      { ...generateTaskFixture, result: { ...generateTaskFixture.result, status: 'RUNNING' } },
      url,
    );
    expect(a).toBe(again);
    expect(a).not.toBe(changed);
  });

  it('forwards new assets even when a task id and status do not change', () => {
    const url = 'https://www.meshy.ai/api/tasks/1';
    const first = { result: { id: 'model-1', status: 'SUCCEEDED', phase: 'generate', result: {} } };
    const ready = { result: { ...first.result, result: { modelUrl: 'https://cdn.example.com/ready.glb' } } };
    expect(payloadSignature(first, url)).not.toBe(payloadSignature(ready, url));
  });
});
