/** GLB container + Meshy v1 decrypt + meshopt decompression tests. */

import { describe, expect, it } from 'vitest';
import { MeshoptDecoder } from 'meshoptimizer';
import { align4, parseGlb, writeGlb, isGlbBytes } from '@/conversion/glb/container';
import { glbToMeshy, isMeshyFile, meshyToGlb, meshyVersion } from '@/conversion/meshy/decrypt';
import { decompressGlb } from '@/conversion/meshopt/decompress';
import { getMeshoptDecoder } from '@/conversion/meshopt/decoder';
import { MeshoptDecoder as ReferenceDecoder } from '@/conversion/meshopt/meshopt-decoder-reference.js';
import { ModelError } from '@/core/errors';
import { AccessorReader } from '@/conversion/gltf/accessors';
import { buildMeshoptGlb, buildMeshyFile, quadMesh } from './helpers/synth';

describe('GLB container', () => {
  it('round-trips json + bin through writeGlb/parseGlb', () => {
    const json = { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] };
    const glb = writeGlb(json, new Uint8Array([1, 2, 3, 4]));
    expect(isGlbBytes(glb)).toBe(true);
    const parsed = parseGlb(glb);
    expect(parsed.json.buffers![0]!.byteLength).toBe(4);
    expect([...parsed.bin]).toEqual([1, 2, 3, 4]);
  });

  it('rejects wrong magic, bad length and truncated chunks', () => {
    expect(() => parseGlb(new ArrayBuffer(64))).toThrow(ModelError);
    const glb = writeGlb({ asset: { version: '2.0' } });
    const corrupt = new Uint8Array(glb);
    new DataView(corrupt.buffer).setUint32(8, 999, true); // wrong total length
    expect(() => parseGlb(corrupt.buffer)).toThrow(/declared length/);
    const truncated = new Uint8Array(glb).subarray(0, 30).slice().buffer;
    expect(() => parseGlb(truncated)).toThrow(ModelError);
  });
});

describe('meshy container decrypt', () => {
  it('detects the MESHY.AI magic', async () => {
    const meshy = await buildMeshyFile(await buildMeshoptGlb({ meshes: [quadMesh()] }));
    expect(isMeshyFile(meshy)).toBe(true);
    expect(meshyVersion(meshy)).toBe(1);
    expect(isMeshyFile(new Uint8Array([1, 2, 3]).buffer)).toBe(false);
  });

  it('rejects unsupported container versions cleanly', async () => {
    const meshy = new Uint8Array(await buildMeshyFile(await buildMeshoptGlb({ meshes: [quadMesh()] })));
    new DataView(meshy.buffer).setUint16(8, 2, true); // v2
    await expect(meshyToGlb(meshy.buffer)).rejects.toThrow(/version/i);
  });

  it('rejects files that are too small or not containers', async () => {
    await expect(meshyToGlb(new ArrayBuffer(8240))).rejects.toThrow(ModelError);
    await expect(meshyToGlb(new Uint8Array(2000).buffer)).rejects.toThrow(ModelError);
  });

  it('round-trips a synthetic .meshy into a valid GLB', async () => {
    const glb = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const meshy = await buildMeshyFile(glb, new Uint8Array(12).fill(7));
    const recovered = await meshyToGlb(meshy);
    const parsed = parseGlb(recovered);
    expect(parsed.json.meshes).toHaveLength(1);
    // Tail bytes are preserved verbatim.
    expect(recovered.byteLength).toBe(glb.byteLength);
  });

  it('passes a plain GLB through untouched', async () => {
    const glb = writeGlb({ asset: { version: '2.0' } });
    await expect(meshyToGlb(glb)).resolves.toBe(glb);
  });
});

describe('meshopt decompression', () => {
  it('resolves EXT_meshopt_compression into a standalone GLB with identical data', async () => {
    const compressed = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const decompressed = await decompressGlb(compressed, MeshoptDecoder);
    const parsed = parseGlb(decompressed);

    expect(parsed.json.extensionsRequired ?? []).not.toContain('EXT_meshopt_compression');
    expect(parsed.json.extensionsUsed ?? []).not.toContain('EXT_meshopt_compression');
    expect(parsed.json.bufferViews!.every((v) => !v.extensions)).toBe(true);
    expect(parsed.json.buffers!.every((b) => !b.uri)).toBe(true);

    // Positions + indices decode to the original quad values.
    const reader = new AccessorReader(parsed);
    const primitive = parsed.json.meshes![0]!.primitives[0]!;
    const positions = reader.readFloats(primitive.attributes.POSITION)!;
    expect([...positions]).toEqual([...quadMesh().positions]);
    const indices = reader.readIndices(primitive.indices!)!;
    expect([...indices]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('leaves an uncompressed GLB untouched', async () => {
    const glb = writeGlb({ asset: { version: '2.0' } });
    await expect(decompressGlb(glb, MeshoptDecoder)).resolves.toBe(glb);
  });

  it('rejects compressed GLBs with external buffers', async () => {
    const glb = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const { json, bin } = parseGlb(glb);
    const external = writeGlb({ ...json, buffers: [{ byteLength: 4, uri: 'external.bin' }] }, bin);
    await expect(decompressGlb(external, MeshoptDecoder)).rejects.toThrow(ModelError);
  });
});

describe('CSP-safe decoder fallback', () => {
  it('pure-JS reference decoder produces byte-identical output to WASM', async () => {
    const compressed = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const viaWasm = await decompressGlb(compressed, MeshoptDecoder);
    const viaReference = await decompressGlb(compressed, ReferenceDecoder);
    expect(new Uint8Array(viaReference)).toEqual(new Uint8Array(viaWasm));
  });

  it('the resolver-chosen decoder decompresses real meshopt geometry', async () => {
    const compressed = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const decoder = await getMeshoptDecoder();
    const glb = await decompressGlb(compressed, decoder);
    const parsed = parseGlb(glb);
    const reader = new AccessorReader(parsed);
    const positions = reader.readFloats(parsed.json.meshes![0]!.primitives[0]!.attributes.POSITION)!;
    expect([...positions]).toEqual([...quadMesh().positions]);
  });
});
