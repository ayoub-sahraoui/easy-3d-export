/**
 * Typed glTF accessor reading over a parsed GLB's binary chunk.
 * Supports the component types Meshy-era glTF files use; anything else
 * fails loudly instead of returning wrong numbers.
 */

import { ModelError } from '@/core/errors';
import type { GlbAccessor, ParsedGlb } from '@/conversion/glb/container';

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_ARITY: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

export class AccessorReader {
  constructor(private readonly glb: ParsedGlb) {}

  accessor(index: number | undefined): GlbAccessor | undefined {
    if (index === undefined || index === null) return undefined;
    return this.glb.json.accessors?.[index];
  }

  /**
   * Read an accessor as a Float32Array (attributes) applying glTF
   * normalization for integer types. Returns null when the accessor is absent.
   */
  readFloats(index: number | undefined): Float32Array | null {
    const acc = this.accessor(index);
    if (!acc) return null;
    const arity = TYPE_ARITY[acc.type];
    if (!arity) throw new ModelError('MODEL_DECODE_FAILED', { detail: `unsupported accessor type ${acc.type}` });
    const out = new Float32Array(acc.count * arity);
    this.readInto(acc, arity, (i, c, v) => {
      out[i * arity + c] = v;
    });
    return out;
  }

  /** Read an index accessor as Uint32Array. Returns null when absent. */
  readIndices(index: number | undefined): Uint32Array | null {
    const acc = this.accessor(index);
    if (!acc) return null;
    if (acc.type !== 'SCALAR') throw new ModelError('MODEL_DECODE_FAILED', { detail: 'indices must be SCALAR' });
    const out = new Uint32Array(acc.count);
    this.readInto(acc, 1, (i, _c, v) => {
      const n = Math.round(v);
      if (n < 0 || !Number.isSafeInteger(n)) throw new ModelError('MODEL_DECODE_FAILED', { detail: 'invalid index value' });
      out[i] = n;
    });
    return out;
  }

  private readInto(
    acc: GlbAccessor,
    arity: number,
    emit: (element: number, component: number, value: number) => void,
  ): void {
    const compBytes = COMPONENT_BYTES[acc.componentType];
    if (!compBytes) {
      throw new ModelError('MODEL_DECODE_FAILED', {
        detail: `unsupported componentType ${acc.componentType}`,
      });
    }
    // Sparse accessors are not expected in Meshy output; fail loudly.
    if ((acc as { sparse?: unknown }).sparse) {
      throw new ModelError('MODEL_DECODE_FAILED', { detail: 'sparse accessors are not supported' });
    }
    const elementBytes = compBytes * arity;
    const views = this.glb.json.bufferViews ?? [];
    const view = acc.bufferView !== undefined ? views[acc.bufferView] : undefined;
    const bin = this.glb.bin;
    const base =
      (view ? (view.byteOffset ?? 0) : 0) + (acc.byteOffset ?? 0);
    const stride = view?.byteStride && view.byteStride >= elementBytes ? view.byteStride : elementBytes;

    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const normalized = acc.normalized === true;
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < arity; c++) {
        const at = base + i * stride + c * compBytes;
        if (at + compBytes > bin.byteLength) {
          throw new ModelError('MODEL_DECODE_FAILED', { detail: 'accessor reads past the binary chunk' });
        }
        let v: number;
        switch (acc.componentType) {
          case 5126:
            v = dv.getFloat32(at, true);
            break;
          case 5125:
            v = dv.getUint32(at, true);
            break;
          case 5123:
            v = dv.getUint16(at, true);
            if (normalized) v /= 65535;
            break;
          case 5122:
            v = dv.getInt16(at, true);
            if (normalized) v = Math.max(v / 32767, -1);
            break;
          case 5121:
            v = dv.getUint8(at);
            if (normalized) v /= 255;
            break;
          case 5120:
            v = dv.getInt8(at);
            if (normalized) v = Math.max(v / 127, -1);
            break;
          default:
            throw new ModelError('MODEL_DECODE_FAILED', { detail: 'unreachable component type' });
        }
        emit(i, c, v);
      }
    }
  }
}
