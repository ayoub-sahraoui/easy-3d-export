const UUID_SUFFIX =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Task id from a Rodin workspace URL, never from another host. */
export function rodinUuidFromPageUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !['hyper3d.ai', 'www.hyper3d.ai'].includes(url.hostname)) return null;
    const match = /^\/workspace\/(?:[a-z]{2}\/)?rodin\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
    return match && UUID_SUFFIX.test(match[1]!) ? match[1]!.toLowerCase() : null;
  } catch { return null; }
}

/** Verified read-only task-card response used by the Rodin workspace. */
export function isRodinEndpoint(url: URL): boolean {
  return url.origin === 'https://api.hyper3d.com' &&
    /^\/api\/task\/card\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname);
}
