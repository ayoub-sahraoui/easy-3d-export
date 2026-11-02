/**
 * OBJ + MTL + textures exporter (packaged as a ZIP).
 *
 * Reads the decoded GLB directly (no scene regeneration), applies node world
 * transforms, and writes:
 *
 * ```text
 * <basename>.obj
 * <basename>.mtl      (mtllib reference inside the .obj)
 * textures/*.png      (embedded images extracted + supplied external textures)
 * ```
 *
 * Honest-loss notes surfaced as warnings: OBJ/MTL cannot represent every PBR
 * property; animation and vertex colors are not written.
 */

import JSZip from 'jszip';
import { ModelError } from '@/core/errors';
import type {
  DecodedModel,
  ExportResult,
  ExportOptions,
  ModelExporter,
} from '@/core/models/types';
import { parseGlb } from '@/conversion/glb/container';
import { AccessorReader } from '@/conversion/gltf/accessors';
import { collectSceneMeshes, normalMatrix, transformPoint } from '@/conversion/gltf/scene';
import { sniffImageMime } from '@/conversion/glb/texture-embed';

interface TextureFile {
  /** Path inside the ZIP, e.g. textures/texture_0.png */
  path: string;
  bytes: ArrayBuffer;
  mimeType: string;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Object.is(n, -0)) n = 0;
  const s = n.toFixed(6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function mtlName(raw: string | undefined, index: number): string {
  const cleaned = (raw ?? `material_${index + 1}`)
    .replace(/[\s\x00-\x1f]+/g, '_')
    .replace(/[^\w.-]/g, '')
    .slice(0, 60);
  return cleaned || `material_${index + 1}`;
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

export const objExporter: ModelExporter = {
  format: 'obj',
  label: 'OBJ',
  capabilities: {
    geometry: true,
    uv: true,
    textures: true,
    materials: true,
    animation: false,
    vertexColors: false,
  },
  async export(model: DecodedModel, options: ExportOptions): Promise<ExportResult> {
    const warnings: string[] = [...model.warnings];
    const parsed = parseGlb(model.glb);
    const reader = new AccessorReader(parsed);
    const { meshes: sceneMeshes, warnings: sceneWarnings } = collectSceneMeshes(parsed);
    warnings.push(...sceneWarnings);

    const json = parsed.json;
    const materials = json.materials ?? [];

    /* ---- texture collection ------------------------------------- */
    const textureFiles = new Map<string, TextureFile>(); // key: material index or 'ext:<i>'
    const mapTargets: { material: string; texturePath: string | null }[] = [];
    const addTextureFile = (key: string, bytes: ArrayBuffer, mime: string, nameHint: string) => {
      const path = `textures/${nameHint}.${extForMime(mime)}`;
      textureFiles.set(key, { path, bytes, mimeType: mime });
      return path;
    };

    // 1) Embedded glTF images referenced by materials.
    const usedMaterialIndices = new Set<number>();
    let anyPrimitiveUnmaterialized = false;
    let anyUv = false;
    for (const sm of sceneMeshes) {
      for (const p of sm.mesh.primitives) {
        if (p.attributes.TEXCOORD_0 !== undefined) anyUv = true;
        if (p.material !== undefined) usedMaterialIndices.add(p.material);
        else anyPrimitiveUnmaterialized = true;
      }
    }

    const mtlEntries: { name: string; kd: [number, number, number]; mapPath: string | null }[] = [];
    const imageBytesCache = new Map<number, ArrayBuffer | null>();
    const imageForTexture = (texIndex: number): { bytes: ArrayBuffer; mime: string } | null => {
      const tex = json.textures?.[texIndex];
      if (!tex || tex.source === undefined) return null;
      const img = json.images?.[tex.source];
      if (!img || img.bufferView === undefined) return null; // external URI images not present in GLB
      if (!imageBytesCache.has(tex.source)) {
        const bv = json.bufferViews?.[img.bufferView];
        if (!bv) {
          imageBytesCache.set(tex.source, null);
        } else {
          const off = bv.byteOffset ?? 0;
          const len = bv.byteLength;
          if (off + len > parsed.bin.length) {
            imageBytesCache.set(tex.source, null);
          } else {
            imageBytesCache.set(tex.source, parsed.bin.slice(off, off + len).buffer);
          }
        }
      }
      const bytes = imageBytesCache.get(tex.source);
      if (!bytes) return null;
      return { bytes, mime: img.mimeType ?? sniffImageMime(bytes) ?? 'image/png' };
    };

    let textureCounter = 0;
    for (const matIndex of usedMaterialIndices) {
      const mat = materials[matIndex];
      const name = mtlName(mat?.name, matIndex);
      const base = mat?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
      let mapPath: string | null = null;
      const bct = mat?.pbrMetallicRoughness?.baseColorTexture;
      if (bct !== undefined) {
        const image = imageForTexture(bct.index);
        if (image) {
          mapPath = addTextureFile(
            `mat:${matIndex}`,
            image.bytes,
            image.mime,
            `texture_${textureCounter++}`,
          );
        }
      }
      mtlEntries.push({ name, kd: [base[0] ?? 1, base[1] ?? 1, base[2] ?? 1], mapPath });
    }

    // 2) External textures supplied by the caller (Meshy textureUrls path).
    const externals = options.includeTextures ? (options.textures ?? []) : [];
    if (externals.length > 0) {
      const untextured = mtlEntries.filter((e) => e.mapPath === null);
      if (!anyUv) {
        warnings.push(
          'The model has no UV coordinates, so the provided texture cannot be mapped reliably. Exported geometry without textures.',
        );
      } else if (untextured.length === 0 && mtlEntries.length > 0 && !anyPrimitiveUnmaterialized) {
        warnings.push('All materials already have textures; supplied external textures were not attached.');
      } else if (externals.length === 1 || untextured.length === externals.length) {
        let used = false;
        externals.forEach((tex, i) => {
          const sniffed = sniffImageMime(tex.bytes);
          if (!sniffed || sniffed !== tex.mimeType) {
            warnings.push(`${tex.name} is not a usable PNG/JPEG/WebP image; skipped.`);
            return;
          }
          const path = addTextureFile(`ext:${i}`, tex.bytes, tex.mimeType, tex.name.replace(/\.[a-z0-9]+$/i, '') || `texture_${textureCounter}`);
          textureCounter++;
          if (untextured.length === externals.length) {
            untextured[i]!.mapPath = path;
          } else {
            for (const entry of untextured) entry.mapPath = path;
            if (mtlEntries.length === 0) {
              mtlEntries.push({ name: 'texture_0', kd: [1, 1, 1], mapPath: path });
            }
          }
          used = true;
        });
        if (used) warnings.push('Attached external texture(s) to material(s) that had none.');
      } else {
        warnings.push(
          `${externals.length} external textures for ${untextured.length} untextured materials — ambiguous, none attached.`,
        );
      }
    }

    // Ensure every mesh has a material entry so `usemtl` always resolves.
    if (mtlEntries.length === 0) {
      mtlEntries.push({ name: 'model_default', kd: [1, 1, 1], mapPath: null });
    }

    /* ---- OBJ body ---------------------------------------------- */
    const lines: string[] = [];
    lines.push(`mtllib ${options.basename}.mtl`);
    let vOffset = 0;
    let vtOffset = 0;
    let vnOffset = 0;
    let totalTriangles = 0;
    let skippedModes = 0;
    let skinnedWarned = false;
    const mtlIndexByMatIndex = new Map<number, number>();
    [...usedMaterialIndices].forEach((matIndex, i) => mtlIndexByMatIndex.set(matIndex, i));

    for (const sm of sceneMeshes) {
      if (sm.skinned && !skinnedWarned) {
        skinnedWarned = true;
        warnings.push('The model is skinned; OBJ export uses the bind-pose transforms.');
      }
      const nMat = normalMatrix(sm.worldMatrix);
      lines.push(`o ${mtlName(sm.name, lines.length)}`);
      for (const primitive of sm.mesh.primitives) {
        if (primitive.mode !== undefined && primitive.mode !== 4) {
          skippedModes++;
          continue;
        }
        const positions = reader.readFloats(primitive.attributes.POSITION);
        if (!positions) continue;
        const normals = reader.readFloats(primitive.attributes.NORMAL);
        const uvs = reader.readFloats(primitive.attributes.TEXCOORD_0);
        const indices = reader.readIndices(primitive.indices);
        const vertexCount = positions.length / 3;

        for (let i = 0; i < vertexCount; i++) {
          const p = transformPoint(sm.worldMatrix, [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]);
          lines.push(`v ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`);
        }
        if (uvs) {
          for (let i = 0; i < uvs.length / 2; i++) {
            lines.push(`vt ${fmt(uvs[i * 2]!)} ${fmt(uvs[i * 2 + 1]!)}`);
          }
        }
        if (normals) {
          for (let i = 0; i < normals.length / 3; i++) {
            let x = nMat[0]! * normals[i * 3]! + nMat[4]! * normals[i * 3 + 1]! + nMat[8]! * normals[i * 3 + 2]!;
            let y = nMat[1]! * normals[i * 3]! + nMat[5]! * normals[i * 3 + 1]! + nMat[9]! * normals[i * 3 + 2]!;
            let z = nMat[2]! * normals[i * 3]! + nMat[6]! * normals[i * 3 + 1]! + nMat[10]! * normals[i * 3 + 2]!;
            const len = Math.hypot(x, y, z);
            if (len > 1e-9) {
              x /= len;
              y /= len;
              z /= len;
            }
            lines.push(`vn ${fmt(x)} ${fmt(y)} ${fmt(z)}`);
          }
        }

        const mtlPos =
          primitive.material !== undefined
            ? (mtlIndexByMatIndex.get(primitive.material) ?? mtlEntries.length - 1)
            : mtlEntries.length - 1;
        lines.push(`usemtl ${mtlEntries[mtlPos]!.name}`);

        const faceCount = indices ? indices.length / 3 : vertexCount / 3;
        for (let f = 0; f < faceCount; f++) {
          const corners: string[] = [];
          for (let c = 0; c < 3; c++) {
            const vi = indices ? indices[f * 3 + c]! : f * 3 + c;
            if (vi >= vertexCount) {
              throw new ModelError('MODEL_DECODE_FAILED', { detail: 'face index exceeds vertex count' });
            }
            const vIdx = vOffset + vi + 1;
            if (uvs) corners.push(`${vIdx}/${vtOffset + vi + 1}${normals ? `/${vnOffset + vi + 1}` : ''}`);
            else if (normals) corners.push(`${vIdx}//${vnOffset + vi + 1}`);
            else corners.push(`${String(vIdx)}`);
          }
          lines.push(`f ${corners.join(' ')}`);
          totalTriangles++;
        }

        vOffset += vertexCount;
        vtOffset += uvs ? uvs.length / 2 : 0;
        vnOffset += normals ? normals.length / 3 : 0;
      }
    }

    if (totalTriangles === 0) {
      throw new ModelError('EXPORT_FAILED', { message: 'No triangle geometry could be written to the OBJ file.' });
    }
    if (skippedModes > 0) {
      warnings.push(`${skippedModes} non-triangle primitive(s) were skipped (OBJ stores triangle meshes).`);
    }
    if (!model.stats.hasNormals) {
      warnings.push('No vertex normals were present; imported meshes may look faceted until normals are recomputed.');
    }
    warnings.push('OBJ/MTL cannot preserve every modern PBR material property (e.g. metal/rough workflow details).');

    /* ---- MTL body ---------------------------------------------- */
    const mtlLines: string[] = ['# Generated by Easy 3D Export'];
    for (const entry of mtlEntries) {
      mtlLines.push(`newmtl ${entry.name}`);
      mtlLines.push(`Ka 0.000 0.000 0.000`);
      mtlLines.push(`Kd ${fmt(entry.kd[0]!)} ${fmt(entry.kd[1]!)} ${fmt(entry.kd[2]!)}`);
      mtlLines.push(`Ks 0.000 0.000 0.000`);
      mtlLines.push('d 1.0000');
      mtlLines.push('Ns 10.0000');
      if (entry.mapPath) mtlLines.push(`map_Kd ${entry.mapPath}`);
      mtlLines.push('');
    }

    /* ---- package ------------------------------------------------ */
    const objText = `${lines.join('\n')}\n`;
    const mtlText = mtlLines.join('\n');
    const zip = new JSZip();
    zip.file(`${options.basename}.obj`, objText);
    zip.file(`${options.basename}.mtl`, mtlText);
    for (const t of textureFiles.values()) {
      zip.file(t.path, t.bytes, { binary: true, compression: 'STORE' });
    }
    const data = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return {
      format: 'obj',
      filename: `${options.basename}_OBJ.zip`,
      data,
      mimeType: 'application/zip',
      packaged: true,
      files: [
        { path: `${options.basename}.obj`, mimeType: 'text/plain', byteLength: objText.length },
        { path: `${options.basename}.mtl`, mimeType: 'text/plain', byteLength: mtlText.length },
        ...[...textureFiles.values()].map((t) => ({
          path: t.path,
          mimeType: t.mimeType,
          byteLength: t.bytes.byteLength,
        })),
      ],
      warnings,
      stats: model.stats,
    };
  },
};
