/**
 * Meshy v1 container → GLB.
 *
 * The reverse-engineered v1 layout (see docs/THIRD_PARTY.md, adapted from
 * meshy2glb, MIT © 2026 Amal David):
 *
 * ```text
 * 0..7      magic "MESHY.AI"
 * 8..9      version (uint16 LE, must be 1)
 * 10..21    12-byte AES nonce
 * 22..31    reserved
 * 32..8223  AES-256-CTR ciphertext (always 8192 bytes)
 * 8224..8239 16-byte tag (skipped, not authenticated)
 * 8240..EOF plaintext tail of the GLB
 * ```
 *
 * The AES key is a fixed ASCII string. Decryption covers only the first 8 KiB
 * of the wrapped GLB; the rest of the file is plaintext. The 16-byte tag is
 * skipped rather than verified, so the output GLB is re-validated afterwards.
 */

import { ModelError } from '@/core/errors';
import { asArrayBuffer, isGlbBytes, MAX_BYTES } from '@/conversion/glb/container';

const MAGIC = 'MESHY.AI';
/** Container header (32) + skipped tag (16). */
const OVERHEAD = 48;
const ENCRYPTED_PREFIX = 8192;
const KEY = 'JSON{"accessors":[{"bufferView":';

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  cachedKey ??= await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(KEY),
    'AES-CTR',
    false,
    ['decrypt', 'encrypt'],
  );
  return cachedKey;
}

export function isMeshyFile(value: ArrayBuffer | Uint8Array): boolean {
  if (!value || value.byteLength < 32) return false;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value, 0, 8) : value.subarray(0, 8);
  return new TextDecoder().decode(bytes) === MAGIC;
}

export function meshyVersion(value: ArrayBuffer | Uint8Array): number {
  const buffer = asArrayBuffer(value);
  if (buffer.byteLength < 10) return -1;
  return new DataView(buffer).getUint16(8, true);
}

/** Decrypt a .meshy v1 container into GLB bytes (meshopt still unresolved). */
export async function meshyToGlb(value: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  const buffer = asArrayBuffer(value);
  if (isGlbBytes(buffer)) return buffer; // pass-through plain GLB input
  if (!isMeshyFile(buffer)) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: 'The file is neither a .meshy container nor a GLB.',
    });
  }
  if (buffer.byteLength < OVERHEAD + ENCRYPTED_PREFIX) {
    throw new ModelError('MODEL_DECODE_FAILED', { message: 'This .meshy file is too small to be valid.' });
  }
  if (buffer.byteLength > MAX_BYTES) {
    throw new ModelError('FILE_TOO_LARGE');
  }
  const version = new DataView(buffer).getUint16(8, true);
  if (version !== 1) {
    throw new ModelError('UNSUPPORTED_MESHY_VERSION', {
      detail: `container version ${version}`,
    });
  }
  const bytes = new Uint8Array(buffer);
  const counter = new Uint8Array(16);
  counter.set(bytes.subarray(10, 22));
  counter[15] = 2;

  const key = await getKey();
  let prefix: ArrayBuffer;
  try {
    prefix = await crypto.subtle.decrypt(
      { name: 'AES-CTR', counter, length: 32 },
      key,
      bytes.subarray(32, 32 + ENCRYPTED_PREFIX),
    );
  } catch (e) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: 'The .meshy container could not be decrypted with the known v1 scheme.',
      detail: String(e),
    });
  }
  if (!isGlbBytes(prefix) || new DataView(prefix).getUint32(4, true) !== 2) {
    throw new ModelError('MODEL_DECODE_FAILED', {
      message: 'Decryption produced garbage — this file may use a newer container.',
    });
  }
  const out = new Uint8Array(buffer.byteLength - OVERHEAD);
  out.set(new Uint8Array(prefix));
  out.set(bytes.subarray(32 + ENCRYPTED_PREFIX + 16), ENCRYPTED_PREFIX);
  // Rewrite the GLB total-length field to the reconstructed size.
  new DataView(out.buffer).setUint32(8, out.length, true);
  return out.buffer;
}

/**
 * Encrypt a GLB into a synthetic .meshy v1 container.
 * Used by tests to build fixtures offline; not used at runtime.
 */
export async function glbToMeshy(value: ArrayBuffer | Uint8Array, nonce = new Uint8Array(12)): Promise<ArrayBuffer> {
  const glb = asArrayBuffer(value);
  if (glb.byteLength < ENCRYPTED_PREFIX) {
    throw new Error('test fixture GLB must be at least 8192 bytes');
  }
  const bytes = new Uint8Array(glb);
  const counter = new Uint8Array(16);
  counter.set(nonce);
  counter[15] = 2;
  const key = await getKey();
  const prefix = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter, length: 32 },
    key,
    bytes.subarray(0, ENCRYPTED_PREFIX),
  );
  const out = new Uint8Array(OVERHEAD + glb.byteLength);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint16(8, 1, true);
  out.set(nonce, 10);
  // 22..32 reserved zeros
  out.set(new Uint8Array(prefix), 32);
  // 16 zero bytes stand in for the skipped tag
  out.set(bytes.subarray(ENCRYPTED_PREFIX), 32 + ENCRYPTED_PREFIX + 16);
  return out.buffer;
}
