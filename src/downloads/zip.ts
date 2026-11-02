/**
 * "Download all" ZIP packaging:
 *
 * ```text
 * <Name>/
 * ├── original/        provider asset(s) + textures
 * ├── converted/       exported GLB (+ unpacked OBJ package)
 * └── metadata.json    provenance without signed tokens
 * ```
 */

import JSZip from 'jszip';
import type { ExportResult, NormalizedModel } from '@/core/models/types';

export interface DownloadAllInput {
  model: NormalizedModel;
  basename: string;
  originalFiles: { path: string; bytes: ArrayBuffer }[];
  conversions: ExportResult[];
}

function sanitizeSegment(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 80) || 'model'
  );
}

/** Redact signed tokens: keep only origins, never full URLs. */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export async function buildDownloadAllZip(input: DownloadAllInput): Promise<{ bytes: ArrayBuffer; filename: string }> {
  const { model, basename, originalFiles, conversions } = input;
  const root = sanitizeSegment(basename);
  const zip = new JSZip();

  for (const file of originalFiles) {
    zip.file(`${root}/original/${sanitizeSegment(file.path)}`, file.bytes, {
      binary: true,
      compression: 'STORE',
    });
  }
  for (const result of conversions) {
    if (!result.packaged) {
      zip.file(`${root}/converted/${sanitizeSegment(result.filename)}`, result.data, {
        binary: true,
        compression: 'STORE',
      });
    } else {
      // Unpack an archive-shaped export (OBJ ZIP) into converted/<name>/
      const inner = await JSZip.loadAsync(result.data);
      for (const entry of Object.values(inner.files)) {
        if (entry.dir) continue;
        const bytes = await entry.async('arraybuffer');
        zip.file(`${root}/converted/${sanitizeSegment(result.filename.replace(/\.zip$/i, ''))}/${entry.name}`, bytes, {
          binary: true,
          compression: 'STORE',
        });
      }
    }
  }

  const metadata = {
    generatedBy: 'Easy 3D Export',
    generatedAt: new Date().toISOString(),
    provider: model.provider,
    modelId: model.id,
    rootId: model.rootId,
    name: model.name,
    status: model.status,
    geometry: model.geometry,
    variants: model.variants.map((v) => ({
      id: v.id,
      kind: v.kind,
      status: v.status,
      sourceTaskId: v.sourceTaskId,
      phase: v.phase,
      triangles: v.triangles,
      vertices: v.vertices,
    })),
    detectedFrom: {
      source: model.provenance?.source,
      origin: originOf(model.provenance?.url),
      detectedAt: model.provenance?.detectedAt,
    },
    conversions: conversions.map((c) => ({
      format: c.format,
      files: c.files.map((f) => f.path),
      warnings: c.warnings,
      stats: c.stats,
    })),
    note: 'Signed provider URLs are intentionally omitted from this file.',
  };
  zip.file(`${root}/metadata.json`, JSON.stringify(metadata, null, 2));

  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  return { bytes, filename: `${root}.zip` };
}
