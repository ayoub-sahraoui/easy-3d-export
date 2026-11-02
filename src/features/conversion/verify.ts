/**
 * Output verification: reload the exported GLB through Three.js' GLTFLoader
 * (an independent implementation) before reporting success.
 */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface VerifiedGlb {
  meshes: number;
  triangles: number;
  hasTextures: boolean;
}

export async function verifyGlbWithThree(bytes: ArrayBuffer): Promise<VerifiedGlb> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(bytes.slice(0), '');
  let meshes = 0;
  let triangles = 0;
  let hasTextures = false;
  gltf.scene.traverse((obj) => {
    const mesh = obj as { isMesh?: boolean; geometry?: { index?: { count: number }; attributes?: { position?: { count: number } } } };
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const indexCount = mesh.geometry.index?.count;
    const positionCount = mesh.geometry.attributes?.position?.count ?? 0;
    triangles += (indexCount ?? positionCount) / 3;
    const material = (obj as { material?: unknown }).material;
    const mats = Array.isArray(material) ? material : [material];
    if (mats.some((m) => !!(m as { map?: unknown } | null | undefined)?.map)) hasTextures = true;
  });
  if (meshes === 0) {
    throw new Error('verification found no meshes');
  }
  return { meshes, triangles: Math.round(triangles), hasTextures };
}
