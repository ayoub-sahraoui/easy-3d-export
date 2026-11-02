/**
 * Conversion pipeline orchestrator: decode → (meshopt) → export.
 *
 * Pure TypeScript, no DOM — runs identically inside the conversion worker
 * and inside Vitest.
 */

import { ModelError, toModelError } from '@/core/errors';
import type {
  ConversionStage,
  ExportResult,
  ExportFormat,
  TextureInput,
} from '@/core/models/types';
import { decoderRegistry } from '@/conversion/decoder-registry';
import { exporterRegistry } from '@/conversion/exporter-registry';
import { isMeshyFile } from '@/conversion/meshy/decrypt';
import { isGlbBytes } from '@/conversion/glb/container';
import { isDracoBytes } from '@/conversion/draco/decode';

export interface ConvertRequest {
  source: { name: string; bytes: ArrayBuffer };
  format: ExportFormat;
  includeTextures: boolean;
  textures: TextureInput[];
  basename: string;
  onStage?: (stage: ConversionStage, detail?: string, progress?: number) => void;
  shouldCancel?: () => boolean;
}

function sniffExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

export async function convertModel(req: ConvertRequest): Promise<ExportResult> {
  const { source, format, includeTextures, textures, basename, onStage, shouldCancel } = req;

  if (source.bytes.byteLength === 0) {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'The file is empty.' });
  }

  // Original pass-through: no conversion, hand back provider bytes.
  if (format === 'original') {
    onStage?.('exporting', 'Packaging original file');
    const ext = isMeshyFile(source.bytes)
      ? 'meshy'
      : isGlbBytes(source.bytes)
        ? 'glb'
        : isDracoBytes(source.bytes) ? 'drc' : sniffExtension(source.name) || 'bin';
    const data = source.bytes;
    return {
      format: 'original',
      filename: `${basename}.${ext}`,
      data,
      mimeType: 'application/octet-stream',
      files: [{ path: `${basename}.${ext}`, mimeType: 'application/octet-stream', byteLength: data.byteLength }],
      packaged: false,
      warnings: [],
    };
  }

  // 1) Decode.
  onStage?.('decoding', 'Decoding model container');
  const decoder =
    decoderRegistry.getForBytes(source.bytes) ??
    decoderRegistry.getForExtension(sniffExtension(source.name));
  if (!decoder) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: `No local decoder supports this file (${source.name}).`,
    });
  }
  const decoded = await decoder.decode(source.bytes, {
    onStage: (s) => onStage?.(s, s === 'decoding' ? 'Decoding model' : 'Decompressing geometry'),
  });
  if (shouldCancel?.()) throw new ModelError('CANCELLED');

  // 2) Export.
  onStage?.('exporting', `Writing ${format.toUpperCase()}`);
  const exporter = exporterRegistry.get(format);
  if (!exporter) {
    throw new ModelError('EXPORT_FAILED', {
      message: `The ${format.toUpperCase()} exporter is not available in this build.`,
    });
  }
  try {
    const result = await exporter.export(decoded, {
      includeTextures,
      textures,
      basename,
    });
    if (shouldCancel?.()) throw new ModelError('CANCELLED');
    return result;
  } catch (e) {
    throw toModelError(e, 'EXPORT_FAILED');
  }
}
