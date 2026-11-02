/**
 * Minimal column-major 4×4 matrix helpers + glTF scene traversal.
 * Sufficient for static rigid/translation/rotation/scale hierarchies, which
 * covers generated-model exports (skinning is intentionally unsupported for
 * OBJ export and reported as a warning instead of silently flattening rigs).
 */

import type { GlbMesh, GlbNode, ParsedGlb } from '@/conversion/glb/container';

export type Mat4 = Float64Array; // column-major, length 16

export const identity4 = (): Mat4 => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

export function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4] ?? 0;
    const b1 = b[c * 4 + 1] ?? 0;
    const b2 = b[c * 4 + 2] ?? 0;
    const b3 = b[c * 4 + 3] ?? 0;
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        (a[r] ?? 0) * b0 + (a[4 + r] ?? 0) * b1 + (a[8 + r] ?? 0) * b2 + (a[12 + r] ?? 0) * b3;
    }
  }
  return out;
}

export function fromTRS(node: GlbNode): Mat4 {
  const tx = node.translation?.[0] ?? 0;
  const ty = node.translation?.[1] ?? 0;
  const tz = node.translation?.[2] ?? 0;
  const x = node.rotation?.[0] ?? 0;
  const y = node.rotation?.[1] ?? 0;
  const z = node.rotation?.[2] ?? 0;
  const w = node.rotation?.[3] ?? 1;
  const sx = node.scale?.[0] ?? 1;
  const sy = node.scale?.[1] ?? 1;
  const sz = node.scale?.[2] ?? 1;
  // quat → matrix (glTF quaternions are [x, y, z, w])
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * sx;
  m[1] = (xy + wz) * sx;
  m[2] = (xz - wy) * sx;
  m[4] = (xy - wz) * sy;
  m[5] = (1 - (xx + zz)) * sy;
  m[6] = (yz + wx) * sy;
  m[8] = (xz + wy) * sz;
  m[9] = (yz - wx) * sz;
  m[10] = (1 - (xx + yy)) * sz;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

export function nodeMatrix(node: GlbNode): Mat4 {
  if (node.matrix && node.matrix.length === 16) {
    const m = new Float64Array(16);
    for (let i = 0; i < 16; i++) m[i] = node.matrix[i]!;
    return m;
  }
  return fromTRS(node);
}

export function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [
    (m[0] ?? 0) * p[0] + (m[4] ?? 0) * p[1] + (m[8] ?? 0) * p[2] + (m[12] ?? 0),
    (m[1] ?? 0) * p[0] + (m[5] ?? 0) * p[1] + (m[9] ?? 0) * p[2] + (m[13] ?? 0),
    (m[2] ?? 0) * p[0] + (m[6] ?? 0) * p[1] + (m[10] ?? 0) * p[2] + (m[14] ?? 0),
  ];
}

/** Upper-3×3 inverse-transpose (adjugate / det), for transforming normals. */
export function normalMatrix(m: Mat4): Mat4 {
  const a = m[0] ?? 0, b = m[4] ?? 0, c = m[8] ?? 0;
  const d = m[1] ?? 0, e = m[5] ?? 0, f = m[9] ?? 0;
  const g = m[2] ?? 0, h = m[6] ?? 0, i = m[10] ?? 0;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const out = new Float64Array(16);
  out[15] = 1;
  if (Math.abs(det) < 1e-12) {
    out[0] = out[5] = out[10] = 1;
    return out; // degenerate scale → keep normals untransformed
  }
  const invDet = 1 / det;
  // inverse of upper 3×3, transposed
  out[0] = A * invDet;
  out[1] = (c * h - b * i) * invDet;
  out[2] = (b * f - c * e) * invDet;
  out[4] = B * invDet;
  out[5] = (a * i - c * g) * invDet;
  out[6] = (c * d - a * f) * invDet;
  out[8] = C * invDet;
  out[9] = (b * g - a * h) * invDet;
  out[10] = (a * e - b * d) * invDet;
  return out;
}

export interface SceneMesh {
  name: string;
  mesh: GlbMesh;
  worldMatrix: Mat4;
  skinned: boolean;
}

/** Flatten the default scene into meshes with world transforms applied. */
export function collectSceneMeshes(glb: ParsedGlb): { meshes: SceneMesh[]; warnings: string[] } {
  const json = glb.json;
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const warnings: string[] = [];
  const collected: SceneMesh[] = [];

  const sceneIndex = json.scene ?? 0;
  const roots = json.scenes?.[sceneIndex]?.nodes ?? [];

  const visit = (nodeIndex: number, parent: Mat4, depth: number) => {
    if (depth > 64) {
      warnings.push('Scene graph is nested too deeply; deeper nodes were skipped.');
      return;
    }
    const node = nodes[nodeIndex];
    if (!node) return;
    const world = matMul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh];
      if (mesh) {
        collected.push({
          name: node.name || mesh.name || `mesh_${collected.length + 1}`,
          mesh,
          worldMatrix: world,
          skinned: node.skin !== undefined,
        });
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };

  const rootMatrix = identity4();
  for (const root of roots) visit(root, rootMatrix, 0);
  if (collected.length === 0) warnings.push('No meshes found in the default scene.');
  return { meshes: collected, warnings };
}
