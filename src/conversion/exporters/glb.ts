/**
 * GLB exporter.
 *
 * Policy (per spec): if the decoded GLB is already suitable for standard
 * viewers — which it is after meshopt resolution — its bytes are passed
 * through unchanged so materials, extras and unknown extensions survive.
 * External textures are attached by glTF-JSON surgery, not scene regeneration.
 */

import type {
  DecodedModel,
  ExportResult,
  ExportOptions,
  ModelExporter,
} from '@/core/models/types';
import { parseGlb } from '@/conversion/glb/container';
import { embedTextures } from '@/conversion/glb/texture-embed';
import { computeGlbStats } from '@/conversion/glb/stats';

export const glbExporter: ModelExporter = {
  format: 'glb',
  label: 'GLB',
  capabilities: {
    geometry: true,
    uv: true,
    textures: true,
    materials: true,
    animation: true,
    vertexColors: true,
  },
  async export(model: DecodedModel, options: ExportOptions): Promise<ExportResult> {
    const warnings: string[] = [...model.warnings];
    let data = model.glb;
    let stats = model.stats;

    if (options.includeTextures && (options.textures?.length ?? 0) > 0) {
      const parsed = parseGlb(model.glb);
      const outcome = embedTextures(parsed.json, parsed.bin, options.textures ?? []);
      warnings.push(...outcome.warnings);
      if (outcome.kind === 'attached') {
        // Re-validate the surgically modified GLB before claiming success.
        const reparsed = parseGlb(outcome.glb);
        data = outcome.glb;
        stats = { ...computeGlbStats(reparsed), hasTextures: true };
      } else if (outcome.reason === 'no-uv') {
        warnings.push(
          'The model has no UV coordinates, so the provided texture cannot be mapped reliably. Exported geometry without textures.',
        );
      } else if (outcome.reason === 'ambiguous') {
        warnings.push('Textures were supplied but could not be matched to materials unambiguously.');
      }
    } else if (!model.stats.hasTextures) {
      warnings.push('The model was converted successfully, but no texture was available.');
    }

    return {
      format: 'glb',
      filename: `${options.basename}.glb`,
      data,
      mimeType: 'model/gltf-binary',
      files: [{ path: `${options.basename}.glb`, mimeType: 'model/gltf-binary', byteLength: data.byteLength }],
      packaged: false,
      warnings,
      stats,
    };
  },
};
