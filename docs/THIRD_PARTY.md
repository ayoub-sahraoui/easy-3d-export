# Third-party software & attribution

Easy 3D Export reuses ideas and small amounts of adapted code from the following
open-source projects. Their notices apply to the adapted portions.

## meshy2glb — https://github.com/Amal-David/meshy2glb

> MIT License © 2026 Amal David

The `.meshy` v1 container layout (header layout, AES-CTR scheme, prefix/tail
reassembly) and the meshopt-to-standalone-GLB rewrite strategy were
reverse-engineered and documented by that project. These Easy 3D Export files adapt
that work for TypeScript and Easy 3D Export's error handling:

- `src/conversion/meshy/decrypt.ts` (container decrypt + test-only encryptor)
- `src/conversion/glb/container.ts` (strict GLB parse/validate/write)
- `src/conversion/meshopt/decompress.ts` (EXT_meshopt_compression resolution)

The full notice is bundled in `public/licenses/meshy2glb-LICENSE.txt`.

The upstream project's own docs note the tag bytes are skipped, not
authenticated — which is why Easy 3D Export re-validates every decrypted GLB before
use, and re-verifies exports with an independent loader.

## meshoptimizer — https://github.com/zeux/meshoptimizer

> MIT License © 2016-2026 Arseny Kapoulkine

WASM decompression/encoders consumed through the `meshoptimizer` npm package
(`MeshoptDecoder` at runtime, `MeshoptEncoder` in tests only). The reference
JavaScript decoder is also vendored as a fallback. The full MIT notice is
bundled in `public/licenses/meshoptimizer-LICENSE.txt`.

## three.js — https://threejs.org

> MIT License © 2010-2026 three.js authors

Used in the Side Panel for the optional 3D preview and for independent
output verification (GLTFLoader re-parse) — never in the conversion worker.

## Google Draco — https://github.com/google/draco

Apache License 2.0, Google Draco contributors. The official `draco3d`
JavaScript decoder and WASM are bundled for local `.drc` decoding; the
encoder is used only to generate synthetic test geometry. The redistribution
license is included in `public/licenses/draco-LICENSE.txt`.

## Other runtime dependencies

- **JSZip** (MIT/GPLv3 dual, MIT used here) — OBJ and "download all" ZIP packaging.
- **Radix UI** (MIT) + **shadcn/ui** (MIT) + **Tailwind CSS** (MIT) — UI primitives.
- **WXT** (MIT), **React** (MIT), **Zustand** (MIT), **Zod** (MIT),
  **Lucide** (ISC), **sonner** (MIT).

## Note on Meshy

Easy 3D Export is not affiliated with Meshy AI. The container format can change at
any time; only `.meshy` **version 1** is supported, and unsupported versions
are rejected with a clear error rather than mis-decoded.
