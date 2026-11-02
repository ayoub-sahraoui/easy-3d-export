/**
 * Resolve EXT_meshopt_compression into a standalone GLB.
 *
 * Adapted from meshy2glb (https://github.com/Amal-David/meshy2glb),
 * MIT License © 2026 Amal David, with Easy 3D Export error mapping.
 *
 * Every other property of the glTF JSON (extras, names, unknown extensions)
 * is preserved byte-for-byte; only bufferViews and the buffers list are
 * rebuilt so the output no longer requires the meshopt extension.
 */

import { ModelError } from '@/core/errors';
import {
  align4,
  MAX_BYTES,
  parseGlb,
  writeGlb,
  type GlbBufferView,
  type ParsedGlb,
} from '@/conversion/glb/container';
import type { MeshoptDecoderLike } from '@/conversion/meshopt/decoder';

export type { MeshoptDecoderLike };

interface MeshoptCompression {
  buffer?: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: string;
  filter?: string;
}

function compressionOf(view: GlbBufferView): MeshoptCompression | undefined {
  const ext = view.extensions?.EXT_meshopt_compression as MeshoptCompression | undefined;
  return ext;
}

export function hasMeshopt(json: ParsedGlb['json']): boolean {
  return (json.bufferViews ?? []).some((v) => compressionOf(v) !== undefined);
}

export async function decompressGlb(
  buffer: ArrayBuffer,
  decoder: MeshoptDecoderLike,
): Promise<ArrayBuffer> {
  const { json, bin } = parseGlb(buffer);
  const views = json.bufferViews ?? [];
  if (!views.some((v) => compressionOf(v))) return buffer;
  if ((json.buffers ?? []).some((b) => b.uri)) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: 'This meshopt GLB references external buffer files, which cannot be resolved locally.',
    });
  }
  await decoder.ready;
  let total = 0;
  const chunks: { offset: number; bytes: Uint8Array }[] = [];
  const outViews: GlbBufferView[] = [];
  for (const view of views) {
    const ext = compressionOf(view);
    const size = ext ? ext.count * ext.byteStride : view.byteLength;
    const off = (ext ? ext.byteOffset : view.byteOffset) ?? 0;
    const len = ext ? ext.byteLength : view.byteLength;
    const sourceBuffer = (ext ? ext.buffer : view.buffer) ?? 0;
    if (sourceBuffer !== 0) {
      throw new ModelError('MODEL_DECODE_FAILED', {
        message: 'Only the embedded source buffer is supported.',
      });
    }
    if (![size, off, len].every((n) => Number.isSafeInteger(n) && n >= 0) || size === 0 || off + len > bin.length) {
      throw new ModelError('MODEL_DECODE_FAILED', { message: 'Invalid meshopt span or buffer size.' });
    }
    if (
      ext &&
      (!Number.isSafeInteger(ext.count) ||
        ext.count <= 0 ||
        !Number.isSafeInteger(ext.byteStride) ||
        ext.byteStride <= 0 ||
        view.byteLength !== size)
    ) {
      throw new ModelError('MODEL_DECODE_FAILED', {
        message: 'Meshopt decoded size does not match its buffer view.',
      });
    }
    const offset = align4(total);
    if (offset + size > MAX_BYTES) throw new ModelError('FILE_TOO_LARGE');
    let bytes: Uint8Array;
    if (ext) {
      bytes = new Uint8Array(size);
      try {
        decoder.decodeGltfBuffer(bytes, ext.count, ext.byteStride, bin.subarray(off, off + len), ext.mode, ext.filter || '');
      } catch (e) {
        throw new ModelError('MODEL_DECODE_FAILED', {
          message: 'Meshopt-compressed geometry could not be decoded.',
          detail: String(e),
        });
      }
    } else {
      bytes = bin.subarray(off, off + len);
    }
    const next: GlbBufferView = { ...view, buffer: 0, byteOffset: offset, byteLength: size };
    if (next.extensions) {
      next.extensions = { ...next.extensions };
      delete next.extensions.EXT_meshopt_compression;
      if (Object.keys(next.extensions).length === 0) delete next.extensions;
    }
    chunks.push({ offset, bytes });
    outViews.push(next);
    total = offset + size;
  }
  const output = { ...json, buffers: [{ byteLength: total }], bufferViews: outViews };
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    const exts = (json[key] ?? []).filter((e) => e !== 'EXT_meshopt_compression');
    if (exts.length > 0) output[key] = exts;
    else delete output[key];
  }
  const binary = new Uint8Array(total);
  for (const { offset, bytes } of chunks) binary.set(bytes, offset);
  return writeGlb(output, binary);
}
