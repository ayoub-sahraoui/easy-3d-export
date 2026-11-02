/**
 * Page inspection (runs in the isolated content script):
 *  - raw JSON documents (Chrome's JSON viewer pages, .json URLs);
 *  - JSON embedded in <script> tags (app state, __NEXT_DATA__, etc.);
 *  - model IDs and asset URLs visible in supported UI structures.
 *
 * Candidates are parsed but NOT trusted — the background re-validates every
 * payload with the provider's schema before anything is displayed.
 */

export interface PageScanCandidate {
  payload: unknown;
  source: 'json-document' | 'page-scan';
  url: string;
}

const MAX_RAW_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_CANDIDATES = 40;

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function scanDocument(doc: Document, pageUrl: string): PageScanCandidate[] {
  const candidates: PageScanCandidate[] = [];
  const push = (text: string | null, source: PageScanCandidate['source']) => {
    if (candidates.length >= MAX_CANDIDATES) return;
    if (!text || text.length === 0) return;
    const cap = source === 'json-document' ? MAX_RAW_BYTES : MAX_SCRIPT_BYTES;
    if (text.length > cap) return;
    const payload = tryParseJson(text);
    if (payload !== undefined && typeof payload === 'object' && payload !== null) {
      candidates.push({ payload, source, url: pageUrl });
    }
  };

  // 1) Raw JSON document: Chrome renders JSON in a bare <pre> (or shows a
  //    viewer whose text is present once expanded). Also handles .json URLs.
  const looksLikeJsonDoc =
    doc.contentType === 'application/json' ||
    /\.json$/i.test(new URL(pageUrl, 'https://x.invalid').pathname) ||
    (doc.body?.childElementCount === 1 && doc.body.firstElementChild?.tagName === 'PRE');
  if (looksLikeJsonDoc) {
    const pre = doc.querySelector('pre');
    if (pre?.textContent) push(pre.textContent, 'json-document');
  }

  // 2) JSON-carrying script tags: app state, hydration payloads.
  const scripts = doc.querySelectorAll(
    'script[type="application/json"], script#__NEXT_DATA__, script[type="application/json" i]',
  );
  for (const script of scripts) {
    if (candidates.length >= MAX_CANDIDATES) break;
    push(script.textContent ?? null, 'page-scan');
  }

  return candidates;
}

/**
 * Stable signature for a parsed payload so repeated identical responses
 * (polling) are forwarded once, not spammed at the background.
 */
export function payloadSignature(payload: unknown, url: string): string {
  const json = JSON.stringify(payload) ?? 'undefined';
  // Include asset changes without retaining large response strings in the dedupe set.
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  }
  return `${url}|${json.length}|${hash >>> 0}`;
}
