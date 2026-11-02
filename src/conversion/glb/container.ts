/**
 * Minimal, strict GLB container utilities: parse, validate, rebuild.
 *
 * Adapted from meshy2glb (https://github.com/Amal-David/meshy2glb),
 * MIT License © 2026 Amal David. Rewritten for TypeScript strictness and
 * Easy 3D Export's error codes.
 */

import { ModelError } from '@/core/errors';

export const MAX_BYTES = 256 * 1024 * 1024;

export interface GlbJson {
  asset?: { version?: string; [k: string]: unknown };
  scene?: number;
  scenes?: { nodes?: number[]; name?: string }[];
  nodes?: GlbNode[];
  meshes?: GlbMesh[];
  materials?: GlbMaterial[];
  accessors?: GlbAccessor[];
  bufferViews?: GlbBufferView[];
  buffers?: { byteLength: number; uri?: string; name?: string }[];
  images?: { bufferView?: number; uri?: string; mimeType?: string; name?: string }[];
  textures?: { sampler?: number; source?: number; name?: string }[];
  samplers?: Record<string, number>[];
  animations?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [k: string]: unknown;
}

export interface GlbNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  name?: string;
  skin?: number;
  [k: string]: unknown;
}

export interface GlbMesh {
  name?: string;
  primitives: {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
    extensions?: Record<string, unknown>;
  }[];
  [k: string]: unknown;
}

export interface GlbMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: { index: number };
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  [k: string]: unknown;
}

export interface GlbAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  min?: number[];
  max?: number[];
  [k: string]: unknown;
}

export interface GlbBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  name?: string;
  target?: number;
  extensions?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ParsedGlb {
  json: GlbJson;
  bin: Uint8Array;
}

export const align4 = (n: number) => Math.ceil(n / 4) * 4;

export function asArrayBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export function isGlbBytes(data: ArrayBuffer | Uint8Array): boolean {
  if (!data || data.byteLength < 4) return false;
  const view = data instanceof ArrayBuffer ? new DataView(data) : new DataView(data.buffer, data.byteOffset, 4);
  return view.getUint32(0, true) === 0x46546c67; // 'glTF'
}

export function parseGlb(input: ArrayBuffer | Uint8Array): ParsedGlb {
  const buffer = asArrayBuffer(input);
  const bytes = new Uint8Array(buffer);
  const d = new DataView(buffer);
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_BYTES) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: 'GLB size is invalid or exceeds 256 MiB.',
    });
  }
  if (d.getUint32(0, true) !== 0x46546c67 || d.getUint32(4, true) !== 2) {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'Expected a GLB version 2 file.' });
  }
  if (d.getUint32(8, true) !== buffer.byteLength) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: 'GLB declared length does not match its actual size.',
    });
  }
  let json: GlbJson | undefined;
  let bin = new Uint8Array(0);
  let at = 12;
  let chunks = 0;
  let hasBin = false;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) throw new ModelError('MODEL_DECODE_FAILED', { message: 'Truncated GLB chunk.' });
    const length = d.getUint32(at, true);
    const type = d.getUint32(at + 4, true);
    if (length % 4 !== 0 || at + 8 + length > bytes.length) {
      throw new ModelError('MODEL_DECODE_FAILED', { message: 'Invalid GLB chunk length or alignment.' });
    }
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (chunks === 0 && type !== 0x4e4f534a) {
      throw new ModelError('MODEL_DECODE_FAILED', { message: 'First GLB chunk must be JSON.' });
    }
    if (type === 0x4e4f534a) {
      if (json) throw new ModelError('MODEL_DECODE_FAILED', { message: 'Duplicate GLB JSON chunk.' });
      try {
        json = JSON.parse(new TextDecoder().decode(data)) as GlbJson;
      } catch {
        throw new ModelError('MODEL_DECODE_FAILED', { message: 'GLB JSON chunk is not parseable.' });
      }
    } else if (type === 0x004e4942) {
      if (hasBin) throw new ModelError('MODEL_DECODE_FAILED', { message: 'Duplicate GLB BIN chunk.' });
      bin = data;
      hasBin = true;
    }
    chunks++;
    at += 8 + length;
  }
  if (!json || json.asset?.version !== '2.0') {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'Expected glTF 2.0 metadata inside the GLB.' });
  }
  const firstBuffer = json.buffers?.[0];
  if (firstBuffer && !firstBuffer.uri && firstBuffer.byteLength > bin.length) {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'GLB binary buffer is truncated.' });
  }
  return { json, bin };
}

export function writeGlb(json: GlbJson, binary: Uint8Array = new Uint8Array(0)): ArrayBuffer {
  const enc = new TextEncoder();
  const jb = enc.encode(JSON.stringify(json));
  const jlen = align4(jb.length);
  const blen = align4(binary.length);
  const length = 12 + 8 + jlen + (binary.length > 0 ? 8 + blen : 0);
  if (length > MAX_BYTES) throw new ModelError('FILE_TOO_LARGE', { message: 'Output exceeds 256 MiB.' });
  const out = new Uint8Array(length);
  const d = new DataView(out.buffer);
  d.setUint32(0, 0x46546c67, true);
  d.setUint32(4, 2, true);
  d.setUint32(8, length, true);
  d.setUint32(12, jlen, true);
  d.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jlen); // pad JSON chunk with spaces
  out.set(jb, 20);
  if (binary.length > 0) {
    const b = 20 + jlen;
    d.setUint32(b, blen, true);
    d.setUint32(b + 4, 0x004e4942, true);
    out.set(binary, b + 8);
  }
  return out.buffer;
}
