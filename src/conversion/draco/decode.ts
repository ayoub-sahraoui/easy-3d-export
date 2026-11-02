import type { Attribute, DecoderModule } from 'draco3d';
import { ModelError, toModelError } from '@/core/errors';
import { MAX_BYTES, writeGlb, type GlbAccessor, type GlbBufferView, type GlbJson } from '@/conversion/glb/container';
import { getDracoModule } from './module';

export function isDracoBytes(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 8) return false;
  const header = new Uint8Array(bytes, 0, 5);
  return header[0] === 68 && header[1] === 82 && header[2] === 65 && header[3] === 67 && header[4] === 79;
}

/** Decode a standalone Draco triangle mesh into ordinary glTF accessors. */
export async function dracoToGlb(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (!isDracoBytes(bytes)) throw new ModelError('MODEL_DECODE_FAILED', { message: 'This is not a Draco geometry file.' });
  if (bytes.byteLength > MAX_BYTES) throw new ModelError('FILE_TOO_LARGE');
  const module = await getDracoModule();
  const decoder = new module.Decoder();
  const buffer = new module.DecoderBuffer();
  const mesh = new module.Mesh();
  let status: ReturnType<typeof decoder.DecodeBufferToMesh> | undefined;
  try {
    buffer.Init(new Int8Array(bytes), bytes.byteLength);
    if (decoder.GetEncodedGeometryType(buffer) !== module.TRIANGULAR_MESH) {
      throw new ModelError('MODEL_DECODE_FAILED', { message: 'This Draco file is a point cloud. A triangle mesh is required for GLB/OBJ export.' });
    }
    status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok()) throw new ModelError('MODEL_DECODE_FAILED', { message: 'The Draco geometry is invalid or uses an unsupported encoding.' });
    const vertices = mesh.num_points();
    const faces = mesh.num_faces();
    if (!Number.isSafeInteger(vertices) || vertices < 3 || !Number.isSafeInteger(faces) || faces < 1) {
      throw new ModelError('MODEL_DECODE_FAILED', { message: 'This Draco file contains no triangle geometry.' });
    }
    // Cap the expanded data before allocating output arrays.
    if (vertices * 12 + faces * 12 > MAX_BYTES) throw new ModelError('FILE_TOO_LARGE');

    const accessors: GlbAccessor[] = [];
    const views: GlbBufferView[] = [];
    const chunks: Uint8Array[] = [];
    let total = 0;
    const append = (data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, width: number, type: string, target: number): number => {
      if (total + data.byteLength > MAX_BYTES) throw new ModelError('FILE_TOO_LARGE');
      const index = accessors.length;
      views.push({ buffer: 0, byteOffset: total, byteLength: data.byteLength, target });
      chunks.push(new Uint8Array(data.buffer));
      total += data.byteLength;
      accessors.push({ bufferView: views.length - 1, componentType: data instanceof Float32Array ? 5126 : 5125, count: data.length / width, type });
      return index;
    };

    const attributes: Record<string, number> = {};
    for (const [semantic, kind, allowed] of [
      ['POSITION', module.POSITION, [3]],
      ['NORMAL', module.NORMAL, [3]],
      ['TEXCOORD_0', module.TEX_COORD, [2]],
      ['COLOR_0', module.COLOR, [3, 4]],
    ] as const) {
      const id = decoder.GetAttributeId(mesh, kind);
      if (id < 0) {
        if (semantic === 'POSITION') throw new ModelError('MODEL_DECODE_FAILED', { message: 'The Draco file has no vertex positions.' });
        continue;
      }
      const attribute = decoder.GetAttribute(mesh, id);
      const width = attribute.num_components();
      if (!(allowed as readonly number[]).includes(width)) {
        throw new ModelError('MODEL_DECODE_FAILED', { message: `The Draco ${semantic} attribute has an unsupported size.` });
      }
      const length = vertices * width;
      if (total + length * 4 + faces * 12 > MAX_BYTES) throw new ModelError('FILE_TOO_LARGE');
      const data = readFloats(module, length, (ptr) => decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, module.DT_FLOAT32, length * 4, ptr));
      if (semantic === 'NORMAL') {
        for (let i = 0; i < data.length; i += 3) {
          const size = Math.hypot(data[i]!, data[i + 1]!, data[i + 2]!);
          if (size === 0) throw new ModelError('MODEL_DECODE_FAILED', { message: 'The Draco file contains invalid normals.' });
          for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! / size;
        }
      }
      if (semantic === 'COLOR_0') {
        const type = (attribute as Attribute & { data_type(): number }).data_type();
        const scale = type === module.DT_UINT8 ? 255 : type === module.DT_UINT16 ? 65535 : 1;
        for (let i = 0; i < data.length; i++) data[i] = Math.min(1, Math.max(0, data[i]! / scale));
      }
      const index = append(data, width, `VEC${width}`, 34962);
      attributes[semantic] = index;
      if (semantic === 'POSITION') {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.length; i++) {
          const component = i % 3;
          min[component] = Math.min(min[component]!, data[i]!);
          max[component] = Math.max(max[component]!, data[i]!);
        }
        accessors[index]!.min = min;
        accessors[index]!.max = max;
      }
    }
    const count = faces * 3;
    const ptr = allocate(module, count * 4);
    let indices: Uint32Array<ArrayBuffer>;
    try {
      decoder.GetTrianglesUInt32Array(mesh, count * 4, ptr);
      indices = new Uint32Array(module.HEAPU8.buffer, ptr, count).slice();
    } finally { module._free(ptr); }
    if (indices.some((index) => index >= vertices)) throw new ModelError('MODEL_DECODE_FAILED', { message: 'The Draco file contains invalid triangle indices.' });
    const indexAccessor = append(indices, 1, 'SCALAR', 34963);
    const binary = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { binary.set(chunk, offset); offset += chunk.length; }
    const json: GlbJson = {
      asset: { version: '2.0', generator: 'Easy 3D Export' },
      scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes, indices: indexAccessor, mode: 4 }] }],
      buffers: [{ byteLength: total }], bufferViews: views, accessors,
    };
    return writeGlb(json, binary);
  } catch (cause) {
    throw toModelError(cause, 'MODEL_DECODE_FAILED');
  } finally {
    if (status) module.destroy(status);
    module.destroy(mesh);
    module.destroy(buffer);
    module.destroy(decoder);
  }
}

function allocate(module: DecoderModule, bytes: number): number {
  const ptr = module._malloc(bytes);
  if (!ptr) throw new ModelError('FILE_TOO_LARGE', { message: 'There is not enough memory to decode this model.' });
  return ptr;
}

function readFloats(module: DecoderModule, count: number, read: (ptr: number) => void): Float32Array<ArrayBuffer> {
  const ptr = allocate(module, count * 4);
  try {
    read(ptr);
    const result = new Float32Array(module.HEAPU8.buffer, ptr, count).slice();
    if (result.some((value) => !Number.isFinite(value))) throw new ModelError('MODEL_DECODE_FAILED', { message: 'The Draco file contains invalid vertex data.' });
    return result;
  } finally { module._free(ptr); }
}
