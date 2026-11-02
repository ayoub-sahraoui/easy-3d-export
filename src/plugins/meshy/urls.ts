const UUID_SUFFIX =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Extract a UUID from a Meshy model-page path, if present. */
export function meshyUuidFromPageUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (
      (u.hostname === 'meshy.ai' || u.hostname === 'www.meshy.ai') &&
      u.protocol === 'https:' &&
      u.pathname.includes('/3d-models/')
    ) {
      const m = UUID_SUFFIX.exec(u.pathname.replace(/\/$/, ''));
      return m ? m[1]!.toLowerCase() : null;
    }
    return null;
  } catch {
    return null;
  }
}


/** Meshy endpoint allowlist: task/metadata endpoints on Meshy hosts only. */
export function isMeshyEndpoint(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const isMeshyHost =
    host === 'meshy.ai' || host === 'www.meshy.ai' || host === 'api.meshy.ai';
  if (!isMeshyHost) return false;
  const path = url.pathname.toLowerCase();
  return (
    path.includes('/tasks') ||
    path.includes('/meshyd-api') ||
    path.includes('/public/') ||
    path.includes('/cdn-models')
  );
}
