/** Shared decode finalization: decompress → validate → stats. */

import { ModelError } from '@/core/errors';
import type { DecodedModel, DecodeOptions } from '@/core/models/types';
import { isGlbBytes, parseGlb } from '@/conversion/glb/container';
import { computeGlbStats } from '@/conversion/glb/stats';
import { decompressGlb, hasMeshopt } from '@/conversion/meshopt/decompress';
import { getMeshoptDecoder } from '@/conversion/meshopt/decoder';

const UNDECODABLE_EXTENSIONS = ['KHR_draco_mesh_compression', 'KHR_texture_basisu'];

/**
 * Turn raw GLB bytes into a validated, self-contained DecodedModel.
 * Resolves EXT_meshopt_compression when present.
 */
export async function finalizeGlb(
  bytes: ArrayBuffer,
  sourceFormat: string,
  options: DecodeOptions = {},
): Promise<DecodedModel> {
  if (!isGlbBytes(bytes)) {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'Decoded output is not a GLB.' });
  }
  let glbBytes = bytes;
  {
    const first = parseGlb(glbBytes); // cheap pre-parse to inspect extensions
    const unsupported = (first.json.extensionsRequired ?? []).filter((e) =>
      UNDECODABLE_EXTENSIONS.includes(e),
    );
    if (unsupported.length > 0) {
      throw new ModelError('MODEL_DECODE_FAILED', {
        message: `This file requires ${unsupported.join(', ')}, which the local converter does not decode.`,
        detail: `extensionsRequired: ${unsupported.join(', ')}`,
      });
    }
    if (hasMeshopt(first.json)) {
      options.onStage?.('decompressing');
      glbBytes = await decompressGlb(glbBytes, await getMeshoptDecoder());
    }
  }
  const parsed = parseGlb(glbBytes); // strict re-validation of the final GLB
  const stats = computeGlbStats(parsed);
  if (stats.meshCount === 0) {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'No triangle meshes found in the file.' });
  }
  const warnings: string[] = [];
  if (!stats.hasNormals) warnings.push('The model has no vertex normals; viewers will compute flat/smooth shading.');
  return { sourceFormat, glb: glbBytes, stats, warnings };
}
