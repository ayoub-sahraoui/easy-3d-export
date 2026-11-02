/** Statistics + capability flags computed from validated glTF JSON. */

import type { DecodedModel } from '@/core/models/types';
import type { ParsedGlb } from '@/conversion/glb/container';

export function computeGlbStats(glb: ParsedGlb): DecodedModel['stats'] {
  const { json } = glb;
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const primitives = meshes.flatMap((m) => m.primitives);
  let triangles = 0;
  let vertices = 0;
  let hasNormals = false;
  let hasUvs = false;
  let meshCount = 0;
  for (const mesh of meshes) {
    if (mesh.primitives.length === 0) continue;
    meshCount++;
    for (const p of mesh.primitives) {
      const posAcc = accessors[p.attributes.POSITION!];
      const idxAcc = p.indices !== undefined ? accessors[p.indices] : undefined;
      if (posAcc) {
        if (idxAcc) triangles += idxAcc.count / 3;
        else triangles += posAcc.count / 3;
        vertices += posAcc.count;
      }
      if (p.attributes.NORMAL !== undefined) hasNormals = true;
      if (p.attributes.TEXCOORD_0 !== undefined) hasUvs = true;
    }
  }
  const materials = json.materials?.length ?? 0;
  const hasTextures =
    (json.images?.length ?? 0) > 0 &&
    primitives.some((p) => {
      const mat = p.material !== undefined ? json.materials?.[p.material] : undefined;
      return mat?.pbrMetallicRoughness?.baseColorTexture !== undefined;
    });
  return {
    meshCount,
    triangles: Math.round(triangles),
    vertices,
    hasNormals,
    hasUvs,
    hasTextures,
    materials,
  };
}
