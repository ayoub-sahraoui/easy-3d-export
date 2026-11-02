/**
 * Test fixture synthesis — build a real .meshy v1 container offline:
 *
 *   tiny scene → meshopt-compressed GLB → AES-CTR .meshy wrapper
 *
 * This lets the whole decrypt→decompress→export pipeline be tested without
 * any real Meshy file (which we could not redistribute anyway).
 */

import { MeshoptEncoder } from 'meshoptimizer';
import {
  align4,
  parseGlb,
  writeGlb,
  type GlbAccessor,
  type GlbBufferView,
  type GlbJson,
} from '@/conversion/glb/container';
import { glbToMeshy } from '@/conversion/meshy/decrypt';

export interface SynthMesh {
  name: string;
  positions: Float32Array; // xyz * n
  normals?: Float32Array;
  uvs?: Float32Array; // uv * n
  indices?: Uint32Array;
}

export interface SynthScene {
  meshes: SynthMesh[];
  /** Node translation applied to the whole scene (tests world transforms). */
  translation?: [number, number, number];
}

/** Compress one bufferView with EXT_meshopt_compression. */
async function compressView(bytes: Uint8Array, count: number, stride: number, mode: string) {
  await MeshoptEncoder.ready;
  return MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode).slice();
}

/** Build a GLB whose bufferViews are meshopt-compressed (ATTRIBUTES/TRIANGLES). */
export async function buildMeshoptGlb(scene: SynthScene, opts: { padTo?: number } = {}): Promise<ArrayBuffer> {
  const bufferViews: GlbBufferView[] = [];
  const accessors: GlbAccessor[] = [];
  const compressedChunks: Uint8Array<ArrayBuffer>[] = [];
  let binLength = 0;

  const pushCompressed = async (
    data: Float32Array | Uint32Array,
    count: number,
    stride: number,
    mode: string,
    componentType: number,
    type: string,
    bounds?: { min: number[]; max: number[] },
  ): Promise<number> => {
    const bytes = new Uint8Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
    const compressed = await compressView(bytes, count, stride, mode);
    const offset = align4(binLength);
    if (offset > binLength) {
      compressedChunks.push(new Uint8Array(offset - binLength));
      binLength = offset;
    }
    compressedChunks.push(compressed);
    const viewIndex = bufferViews.length;
    // meshopt semantics: bufferView.byteLength is the DECODED size; the
    // extension describes the compressed span inside the buffer.
    bufferViews.push({
      buffer: 0,
      byteOffset: binLength,
      byteLength: count * stride,
      extensions: {
        EXT_meshopt_compression: {
          buffer: 0,
          byteOffset: binLength,
          byteLength: compressed.byteLength,
          byteStride: stride,
          count,
          mode,
          filter: '',
        },
      },
    });
    binLength += compressed.byteLength;
    const accessor: GlbAccessor = {
      bufferView: viewIndex,
      componentType,
      count,
      type,
      ...(bounds ? { min: bounds.min, max: bounds.max } : {}),
    };
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const meshesJson: GlbJson['meshes'] = [];
  const nodes: GlbJson['nodes'] = [];
  for (const mesh of scene.meshes) {
    const vertexCount = mesh.positions.length / 3;
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c]!, mesh.positions[i + c]!);
        max[c] = Math.max(max[c]!, mesh.positions[i + c]!);
      }
    }
    const attributes: Record<string, number> = {
      POSITION: await pushCompressed(mesh.positions, vertexCount, 12, 'ATTRIBUTES', 5126, 'VEC3', { min, max }),
    };
    if (mesh.normals) {
      attributes.NORMAL = await pushCompressed(mesh.normals, vertexCount, 12, 'ATTRIBUTES', 5126, 'VEC3');
    }
    if (mesh.uvs) {
      attributes.TEXCOORD_0 = await pushCompressed(mesh.uvs, vertexCount, 8, 'ATTRIBUTES', 5126, 'VEC2');
    }
    let indicesAccessor: number | undefined;
    if (mesh.indices) {
      indicesAccessor = await pushCompressed(mesh.indices, mesh.indices.length, 4, 'TRIANGLES', 5125, 'SCALAR');
    }
    meshesJson.push({
      name: mesh.name,
      primitives: [{ attributes, ...(indicesAccessor !== undefined ? { indices: indicesAccessor } : {}), mode: 4 }],
    });
    nodes.push({ mesh: meshesJson.length - 1, name: mesh.name });
  }
  if (scene.translation) {
    nodes[nodes.length - 1]!.translation = scene.translation;
  }

  const bin = new Uint8Array(binLength);
  let at = 0;
  for (const chunk of compressedChunks) {
    bin.set(chunk, at);
    at += chunk.byteLength;
  }

  const json: GlbJson = {
    asset: { version: '2.0', generator: 'modelport-test-synth' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: meshesJson,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
    extensionsUsed: ['EXT_meshopt_compression'],
    extensionsRequired: ['EXT_meshopt_compression'],
  };

  let glb = writeGlb(json, bin);
  // The v1 container encrypts a fixed 8 KiB prefix, so the GLB must reach
  // that size; pad with a JSON-safe copyright string (overshoot is fine).
  const minimum = opts.padTo ?? 8192;
  if (glb.byteLength < minimum) {
    const need = minimum - glb.byteLength + 64;
    json.asset = {
      version: '2.0',
      generator: 'modelport-test-synth',
      copyright: '_'.repeat(need),
    };
    glb = writeGlb(json, bin);
  }
  return glb;
}

/** Wrap a GLB into a .meshy v1 container (encrypts the 8 KiB prefix). */
export async function buildMeshyFile(
  glb: ArrayBuffer,
  nonce?: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  return glbToMeshy(glb, nonce);
}

/** A minimal 2-triangle quad mesh with UVs + normals. */
export function quadMesh(): SynthMesh {
  return {
    name: 'quad',
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    uvs: new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** Minimal 1×1 PNG with known bytes. */
export function tinyPng(): ArrayBuffer {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND
    0x42, 0x60, 0x82,
  ]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export { parseGlb };
