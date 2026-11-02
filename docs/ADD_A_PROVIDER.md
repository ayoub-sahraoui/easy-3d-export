# Adding a provider plugin

Meshy and Hyper3D Rodin are working references. Provider-specific JSON belongs
in the adapter; binary conversion remains format-based.

## 1. Implement the adapter

Add `src/plugins/<name>/index.ts` implementing `ProviderPlugin` from
`src/plugins/types.ts`, with a
schema and normalizer based on verified responses.

- Recognize a real task shape and validate it before normalizing.
- Use a stable model/task id; merge updates without duplicating the model.
- Return only model fields. Do not retain account details or authorization tokens.
- Validate all asset URLs and discard placeholders such as `FILE_NOT_FOUND`.
- Assign truthful capabilities and source extensions. Rodin preview geometry is
  `.drc`, not GLB; Meshy containers are `.meshy`.
- Set `modelIdFromPage` when a workspace URL identifies one task. The background
  will then follow SPA navigation without showing a previous page's model.
- Implement network-free `resolveAssets` for filenames and signed-URL expiry.
- Do not advertise an exporter until the source format can actually be decoded.

Register the plugin once in `src/plugins/registry.ts`. IDs are open-ended strings;
use a stable, unique id (the `local` id is reserved for file imports). No core type,
Settings UI, import dispatcher, or per-provider entrypoint edits are needed.

## 2. Declare site integration in the plugin

- `description`: short explanation for its Settings row.
- `defaultEnabled`: used only when no valid saved preference exists. Meshy and
  Rodin both default to `true`; a saved `false` is never overwritten.
- `supportedOrigins` and `matchesUrl`: origins used to associate a tab or page URL
  with this provider. Match HTTPS origins exactly.
- `detection.matches`: Chrome match patterns for pages that host the viewer.
- `detection.isEndpoint`: allowlist for verified model metadata response URLs.
  Never observe unrelated login/account endpoints.
- `hostPermissions`: only the page, API, and asset hosts required by the plugin.
  The manifest collects these automatically. Other asset origins use the existing
  optional per-origin permission flow.
- Optional `pageRequest(url)`: return a verified public metadata request with
  `url`, optional `method` (`GET`/`POST`), `body`, and `loginMessage`. Return
  `undefined` for URLs that are not model pages. Requests are anonymous and capped
  at 2 MiB. Private workspaces rely on observation of the logged-in page.

The generic `providers-main.content.ts` / `providers.content.ts` entrypoints
collect match patterns from the registry. They start and stop the shared network
bridge and document scanner according to saved settings, including live changes.
The background independently rechecks plugin state and the sender's tab origin.
Do not read login tokens or add authentication headers to public requests.

For Rodin, the verified route is
`POST https://api.hyper3d.com/api/task/card/<task_uuid>`. Observation reads the
JSON response and leaves the request's headers, authentication, and body alone.

## 3. Route the real source format

Use the existing GLB, Meshy v1, and standalone Draco decoders when applicable.
If another source format is required, implement `ModelDecoder` and register it
in `src/conversion/decoder-registry.ts`.

Keep WASM and decoder JavaScript packaged locally. Do not load CDN decoder
scripts or weaken CSP to allow JavaScript evaluation. Model bytes stay in the
panel/worker path; Chrome runtime messages serialize binary data as JSON.

Update local-file import acceptance and user-facing format descriptions when
adding a source extension. Geometry-only sources must not imply that their
preview/input images are usable texture maps.

## 4. Add manual imports when feasible

The shared JSON importer discovers the registered plugin automatically and
rejects new imports when that plugin is disabled. Implement `pageRequest` for
public model-page URL imports; no provider-specific branching belongs in the
shared importer.
Public workspace URL imports may call a verified read-only metadata endpoint
without credentials. Private workspaces use response observation in the user's
logged-in provider page. Never embed a user token in the extension.

## 5. Verify the whole path

Include sanitized fixtures derived from real responses, without emails,
bearer tokens, signing credentials, or live signed URLs. Cover recognition,
normalization, refresh/merge behavior, safe URLs, expiry, and page selection.

Use generated binary fixtures to verify decoding and geometry/attribute
preservation. Also check the built extension in Chromium under its real CSP:
detect a task, fetch its asset, run the worker, verify the GLB, and save it.
For a new format, validate an actual output independently and check that a
target editor can import it.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Add coverage for
enabled/disabled behavior, including no page requests while disabled. Existing
plugin preference and lifecycle tests exercise both bundled integrations.
No remote plugin loader is supported; new integrations are bundled at build time.
