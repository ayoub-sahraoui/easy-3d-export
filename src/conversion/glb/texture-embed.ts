/**
 * Attach externally supplied texture files (e.g. Meshy textureUrls PNGs) to a
 * decoded GLB by glTF-JSON surgery: append bytes to the BIN chunk and add
 * image/texture/sampler entries + baseColorTexture references.
 *
 * Everything else in the JSON is preserved untouched — no scene regeneration,
 * so materials, extras and unknown extensions survive byte-for-byte.
 */

import type { TextureInput } from '@/core/models/types';
import { align4, writeGlb, type GlbJson } from '@/conversion/glb/container';

export type EmbedOutcome =
  | { kind: 'attached'; glb: ArrayBuffer; warnings: string[]; attachedCount: number }
  | { kind: 'skipped'; reason: 'no-uv' | 'already-textured' | 'ambiguous' | 'invalid-images' | 'none-supplied'; warnings: string[] };

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]; // RIFF
const WEBP_LP = [0x57, 0x45, 0x42, 0x50]; // WEBP at offset 8

export function sniffImageMime(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const starts = (sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
  if (starts(PNG)) return 'image/png';
  if (starts(JPEG)) return 'image/jpeg';
  if (starts(WEBP_RIFF) && starts(WEBP_LP, 8)) return 'image/webp';
  return null;
}

/** True when at least one primitive declares UVs. */
export function glbHasUvs(json: GlbJson): boolean {
  return (json.meshes ?? []).some((m) =>
    m.primitives.some((p) => p.attributes.TEXCOORD_0 !== undefined),
  );
}

export function glbHasBaseColorTexture(json: GlbJson): boolean {
  const mats = json.materials ?? [];
  return (json.meshes ?? []).some((m) =>
    m.primitives.some((p) => {
      const mat = p.material !== undefined ? mats[p.material] : undefined;
      return mat?.pbrMetallicRoughness?.baseColorTexture !== undefined;
    }),
  );
}

/**
 * Embed textures into a GLB.
 *
 * Assignment policy (documented, no guessing):
 *  - one texture → attach to every material that lacks a baseColorTexture
 *    (creating a default material when primitives have none);
 *  - N textures with exactly N texture-less materials → 1:1 in order;
 *  - anything else → skipped as ambiguous rather than mapped arbitrarily.
 */
export function embedTextures(
  json: GlbJson,
  bin: Uint8Array,
  textures: TextureInput[],
): EmbedOutcome {
  const warnings: string[] = [];
  if (textures.length === 0) {
    return { kind: 'skipped', reason: 'none-supplied', warnings };
  }
  const valid: TextureInput[] = [];
  for (const t of textures) {
    const mime = sniffImageMime(t.bytes);
    if (!mime || mime !== t.mimeType) {
      warnings.push(`${t.name} is not a usable PNG/JPEG/WebP image; skipped.`);
    } else {
      valid.push(t);
    }
  }
  if (valid.length === 0) {
    return { kind: 'skipped', reason: 'invalid-images', warnings };
  }

  const materials = json.materials ? [...json.materials] : [];
  const meshes = json.meshes ?? [];
  const primitives = meshes.flatMap((m) => m.primitives);

  const anyUv = primitives.some((p) => p.attributes.TEXCOORD_0 !== undefined);
  if (!anyUv) {
    return { kind: 'skipped', reason: 'no-uv', warnings };
  }

  // Indices of materials that lack a baseColorTexture and are used by UV-carrying primitives.
  const usedNoTexture = new Set<number>();
  let unmaterializedUvs = 0;
  for (const p of primitives) {
    if (p.attributes.TEXCOORD_0 === undefined) continue;
    if (p.material === undefined) {
      unmaterializedUvs++;
      continue;
    }
    const mat = materials[p.material];
    if (!mat?.pbrMetallicRoughness?.baseColorTexture) usedNoTexture.add(p.material);
  }

  const existingTextureCount = glbHasBaseColorTexture(json) ? 1 : 0;
  if (existingTextureCount > 0 && usedNoTexture.size === 0 && unmaterializedUvs === 0) {
    return { kind: 'skipped', reason: 'already-textured', warnings };
  }

  // Decide which material indices the supplied textures attach to.
  //  - one texture → every untextured target (creating a default material
  //    when UV-carrying primitives have no material at all);
  //  - N textures → exactly N existing untextured materials, in order;
  //    unmaterialized primitives make N-way assignment ambiguous.
  let createdMaterialIndex: number | undefined;
  const targets: number[] = [...usedNoTexture];
  if (unmaterializedUvs > 0) {
    if (valid.length > 1) {
      warnings.push(
        `${valid.length} textures supplied, but some meshes have no material to map them onto — assignment is ambiguous, textures were not embedded.`,
      );
      return { kind: 'skipped', reason: 'ambiguous', warnings };
    }
    createdMaterialIndex = materials.length;
    materials.push({ name: 'texture_0' });
    targets.push(createdMaterialIndex);
  }

  if (valid.length > 1 && targets.length !== valid.length) {
    warnings.push(
      `${valid.length} textures supplied for ${targets.length} untextured materials — assignment is ambiguous, textures were not embedded.`,
    );
    return { kind: 'skipped', reason: 'ambiguous', warnings };
  }

  // Append image bytes + bufferViews.
  const bufferViews = json.bufferViews ? [...json.bufferViews] : [];
  const images = json.images ? [...json.images] : [];
  const textureEntries = json.textures ? [...json.textures] : [];
  const samplers = json.samplers ? [...json.samplers] : [];
  const samplerIndex = samplers.length;
  samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });

  const binChunks: Uint8Array[] = [bin];
  let binLength = bin.length;
  const newTextureIndices: number[] = [];
  for (const t of valid) {
    const offset = align4(binLength);
    if (offset > binLength) {
      binChunks.push(new Uint8Array(offset - binLength));
      binLength = offset;
    }
    const bytes = new Uint8Array(t.bytes);
    binChunks.push(bytes);
    const bvIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, name: `texture_${images.length}` });
    binLength += bytes.byteLength;
    const imageIndex = images.length;
    images.push({ bufferView: bvIndex, mimeType: t.mimeType, name: t.name.replace(/\.[a-z0-9]+$/i, '') });
    const textureIndex = textureEntries.length;
    textureEntries.push({ sampler: samplerIndex, source: imageIndex });
    newTextureIndices.push(textureIndex);
  }

  // Wire baseColorTexture into each target material.
  let attachedCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const matIndex = targets[i]!;
    const textureIndex = valid.length === 1 ? newTextureIndices[0]! : newTextureIndices[i]!;
    const mat = { ...materials[matIndex]! };
    mat.pbrMetallicRoughness = {
      ...(mat.pbrMetallicRoughness ?? {}),
      baseColorTexture: { index: textureIndex },
    };
    materials[matIndex] = mat;
    attachedCount++;
  }

  // Point unmaterialized UV primitives at the created default material.
  if (createdMaterialIndex !== undefined) {
    for (const mesh of meshes) {
      for (const p of mesh.primitives) {
        if (p.attributes.TEXCOORD_0 !== undefined && p.material === undefined) {
          p.material = createdMaterialIndex;
        }
      }
    }
  }

  const nextBin = new Uint8Array(binLength);
  let at = 0;
  for (const chunk of binChunks) {
    nextBin.set(chunk, at);
    at += chunk.byteLength;
  }

  const outJson: GlbJson = {
    ...json,
    materials,
    bufferViews,
    images,
    textures: textureEntries,
    samplers,
    buffers: [{ byteLength: binLength }],
  };
  return { kind: 'attached', glb: writeGlb(outJson, nextBin), warnings, attachedCount };
}
