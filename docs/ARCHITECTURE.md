# Architecture and local conversion

Four strategies, scoped to supported provider pages:

1. **Page inspection** — embedded JSON (`<script type="application/json">`,
   hydration state) and raw JSON documents.
2. **Network observation** — a main-world bridge (installed at
   `document_start`) wraps `fetch`/`XMLHttpRequest`, clones allowlisted
   JSON responses from Meshy task endpoints and the verified Rodin
   `api.hyper3d.com/api/task/card/<uuid>` endpoint, and forwards them as *data*
   through the isolated content script to the background, which re-validates
   every payload with Zod-derived schemas before normalizing. Original
   methods are fully preserved; only JSON bodies from allowlisted endpoints
   are read; nothing about your other browsing is touched.
3. **Direct JSON input** — paste task JSON in the import dialog, or open a
   raw task endpoint URL in a tab.
4. **Manual import** — paste a Meshy model-page URL (resolved via Meshy's
   public task endpoint), paste a direct asset URL, or drop local
   `.meshy`/`.glb`/`.drc` files plus textures. Public Rodin workspace URLs
   use an anonymous read-only task-card POST; private tasks can be detected
   from the logged-in provider page without copying or storing a login token.

The panel never claims a model was "detected" without a real source — if the
page predates the observer it says so and offers a refresh.

## Conversion, locally

The `.meshy` v1 container wraps a GLB in a thin AES-256-CTR layer over its
first 8 KiB (fixed key, 12-byte nonce at offset 10, 16-byte skipped tag) and
uses `EXT_meshopt_compression` for geometry. Easy 3D Export decrypts with
WebCrypto, resolves meshopt with the MIT-licensed `meshoptimizer` WASM
decoder, re-validates the result as a strict GLB 2.0, and then:

- **GLB export** passes the decoded bytes through untouched (materials,
  extras and unknown extensions survive); supplied external textures are
  attached by glTF-JSON surgery only when UVs exist and assignment is
  unambiguous.
- **OBJ export** reads the GLB directly (own accessor/scene-graph code),
  applies node world transforms, writes `.obj` + `.mtl` +
  `textures/*.png` into a ZIP.

All of this runs in a **dedicated Web Worker** so the panel stays responsive.
Everything is format-based — the conversion engine (`src/conversion/`) has
zero imports from `src/plugins/`. Standalone Draco triangle meshes are
decoded into standard float vertex attributes and triangle indices. GLBs
requiring `KHR_draco_mesh_compression` or KTX2, and newer `.meshy` versions,
remain explicitly unsupported.

## Hyper3D Rodin

Open a Rodin workspace model and refresh it after installing or reloading the
extension. Easy 3D Export observes its task-card response and lists the
`model_preview_info.preview_sdf` `.drc` asset as **Preview geometry**. You can
also paste the task JSON, import a public workspace URL, or import a `.drc`
file directly.

- **Original** downloads the compressed `.drc` unchanged.
- **GLB** decodes the mesh into an ordinary, uncompressed GLB for editing.
- **OBJ** packages the decoded geometry using the existing OBJ exporter.

Positions, normals, UVs, and vertex colors are preserved when present in the
Draco source. The supplied Rodin preview contains positions only: textures,
materials, and the original scene hierarchy cannot be recovered from that
file. No texture is inferred from a preview or input image. Point-cloud DRC
files and Draco-compressed GLB output are not supported.

The decoder's JavaScript and WASM are packaged with the extension and run
locally. Account details and bearer tokens are not saved in provider
fixtures or normalized models.

## Permissions & privacy

| Permission | Why |
| --- | --- |
| `sidePanel` | the entire UI lives in Chrome's Side Panel |
| `activeTab` | know which tab the panel is attached to when you open it |
| `storage` | remember your format, texture, theme, and provider-plugin preferences |
| `downloads` | save originals and converted files to disk |
| `https://meshy.ai/*`, `https://www.meshy.ai/*`, `https://api.meshy.ai/*` | run the scoped observer and fetch Meshy assets — `api.meshy.ai` is where signed `.meshy`/texture files are actually served |
| `https://hyper3d.ai/*`, `https://www.hyper3d.ai/*`, `https://api.hyper3d.com/*`, `https://file.hyper3d.com/*` | observe Rodin task cards and download signed model/preview assets |
| `optional_host_permissions: https://*/*` | other asset CDNs: fetched **only** after you approve a per-site request (the panel shows a "grant access and retry" action when a host blocks extension fetches) |
| `content_security_policy.extension_pages` | `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';` permits bundled WebAssembly in extension pages and workers; the meshopt decoder is imported only after a runtime availability check, with a vendored pure-JS fallback where WASM is blocked |

- No analytics, no remote code, no CDN scripts — everything is bundled (MV3 CSP).
- Model bytes stay in memory until you save them; model files are never persisted.
- Signed URLs are never logged or written into exported `metadata.json` (only origins).
- Conversion happens 100% locally.

Full attribution for the adapted `.meshy` research: [THIRD_PARTY.md](THIRD_PARTY.md).
