/**
 * Meshopt decoder resolution with a CSP-safe fallback.
 *
 * Probe WASM before importing the decoder: meshoptimizer starts compilation
 * during module evaluation, so an eager import can reject before the CSP-safe
 * fallback runs. Import only the decoder to avoid initializing unused WASM
 * modules from the package root.
 */

import { MeshoptDecoder as ReferenceDecoder } from '@/conversion/meshopt/meshopt-decoder-reference';

export interface MeshoptDecoderLike {
  ready: Promise<unknown> | void;
  decodeGltfBuffer(
    dst: Uint8Array,
    count: number,
    byteStride: number,
    src: Uint8Array,
    mode: string,
    filter: string,
  ): void;
}

/** A minimal valid empty WebAssembly module (header only). */
const EMPTY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function withTimeout(p: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** True when this context permits WebAssembly compilation at all. */
async function wasmAllowed(): Promise<boolean> {
  try {
    await withTimeout(WebAssembly.instantiate(EMPTY_WASM), 2000);
    return true;
  } catch {
    return false;
  }
}

let cached: Promise<MeshoptDecoderLike> | null = null;

/** Resolve the best available meshopt decoder for this context (cached). */
export function getMeshoptDecoder(): Promise<MeshoptDecoderLike> {
  cached ??= (async () => {
    if (await wasmAllowed()) {
      try {
        const { MeshoptDecoder: WasmDecoder } = await import('meshoptimizer/decoder');
        await withTimeout(Promise.resolve(WasmDecoder.ready), 5000);
        return WasmDecoder;
      } catch {
        /* WASM allowed but meshopt init failed — fall through */
      }
    }
    await Promise.resolve(ReferenceDecoder.ready).catch(() => undefined);
    return ReferenceDecoder;
  })();
  return cached;
}
