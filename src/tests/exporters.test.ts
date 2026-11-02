/** Full pipeline + exporter tests: meshy→GLB, meshy→OBJ ZIP, textures. */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convertModel } from '@/conversion/pipeline';
import { parseGlb } from '@/conversion/glb/container';
import { embedTextures, sniffImageMime } from '@/conversion/glb/texture-embed';
import { decoderRegistry } from '@/conversion/decoder-registry';
import { exporterRegistry } from '@/conversion/exporter-registry';
import { buildMeshoptGlb, buildMeshyFile, quadMesh, tinyPng } from './helpers/synth';
import { matMul, fromTRS, identity4, normalMatrix, transformPoint } from '@/conversion/gltf/scene';
import type { EmbedOutcome } from '@/conversion/glb/texture-embed';
import type { GlbNode } from '@/conversion/glb/container';

function expectSkipped(outcome: EmbedOutcome, reason: string) {
  if (outcome.kind !== 'skipped') throw new Error(`expected skipped, got ${outcome.kind}`);
  expect(outcome.reason).toBe(reason);
}

async function synthMeshy(translation?: [number, number, number]) {
  const glb = await buildMeshoptGlb({ meshes: [quadMesh()], translation });
  return buildMeshyFile(glb);
}

describe('decoder registry', () => {
  it('picks the meshy decoder by magic bytes', async () => {
    const meshy = await synthMeshy();
    expect(decoderRegistry.getForBytes(meshy)?.id).toBe('meshy-v1');
  });
});

describe('pipeline: meshy → GLB', () => {
  it('converts a synthetic .meshy to a valid standalone GLB', async () => {
    const meshy = await synthMeshy();
    const result = await convertModel({
      source: { name: 'quad.meshy', bytes: meshy },
      format: 'glb',
      includeTextures: false,
      textures: [],
      basename: 'quad',
    });
    expect(result.format).toBe('glb');
    expect(result.filename).toBe('quad.glb');
    expect(result.packaged).toBe(false);
    expect(result.stats).toMatchObject({ meshCount: 1, triangles: 2, vertices: 4, hasUvs: true, hasNormals: true });
    const parsed = parseGlb(result.data);
    expect(parsed.json.extensionsRequired ?? []).not.toContain('EXT_meshopt_compression');
  });

  it('passes originals through untouched', async () => {
    const meshy = await synthMeshy();
    const result = await convertModel({
      source: { name: 'quad.meshy', bytes: meshy },
      format: 'original',
      includeTextures: false,
      textures: [],
      basename: 'quad',
    });
    expect(result.filename).toBe('quad.meshy');
    expect(result.data.byteLength).toBe(meshy.byteLength);
  });

  it('rejects unknown binary input', async () => {
    await expect(
      convertModel({
        source: { name: 'model.xyz', bytes: new Uint8Array(64).buffer },
        format: 'glb',
        includeTextures: false,
        textures: [],
        basename: 'x',
      }),
    ).rejects.toThrow(/decoder/i);
  });
});

describe('pipeline: meshy → OBJ ZIP', () => {
  it('writes OBJ + MTL with correct geometry and references', async () => {
    const meshy = await synthMeshy();
    const result = await convertModel({
      source: { name: 'quad.meshy', bytes: meshy },
      format: 'obj',
      includeTextures: false,
      textures: [],
      basename: 'quad',
    });
    expect(result.packaged).toBe(true);
    expect(result.filename).toBe('quad_OBJ.zip');

    const zip = await JSZip.loadAsync(result.data);
    const obj = await zip.file('quad.obj')!.async('string');
    const mtl = await zip.file('quad.mtl')!.async('string');

    // OBJ structure: mtllib, 4 v, 4 vt, 4 vn, 2 faces with v/vt/vn triples.
    expect(obj).toContain('mtllib quad.mtl');
    const vCount = (obj.match(/^v /gm) ?? []).length;
    const vtCount = (obj.match(/^vt /gm) ?? []).length;
    const vnCount = (obj.match(/^vn /gm) ?? []).length;
    const fCount = (obj.match(/^f /gm) ?? []).length;
    expect(vCount).toBe(4);
    expect(vtCount).toBe(4);
    expect(vnCount).toBe(4);
    expect(fCount).toBe(2);
    // First face maps to the quad corner vertices 1..3 (1-based).
    expect(obj).toMatch(/^f 1\/1\/1 2\/2\/2 3\/3\/3$/m);
    expect(obj).toContain('usemtl ');

    // MTL exists with a material and no texture (none supplied).
    expect(mtl).toContain('newmtl ');
    expect(mtl).not.toContain('map_Kd');
  });

  it('packages a supplied external texture and references it from the MTL', async () => {
    const meshy = await synthMeshy();
    const png = tinyPng();
    const result = await convertModel({
      source: { name: 'quad.meshy', bytes: meshy },
      format: 'obj',
      includeTextures: true,
      textures: [{ name: 'texture_0.png', bytes: png, mimeType: 'image/png' }],
      basename: 'quad',
    });
    const zip = await JSZip.loadAsync(result.data);
    const mtl = await zip.file('quad.mtl')!.async('string');
    expect(mtl).toContain('map_Kd textures/texture_0.png');
    const stored = await zip.file('textures/texture_0.png')!.async('uint8array');
    expect(stored.byteLength).toBe(png.byteLength);
    expect([...stored.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('applies node world transforms to exported vertices', async () => {
    const meshy = await synthMeshy([10, 0, 0]); // scene translated by +10 x
    const result = await convertModel({
      source: { name: 'quad.meshy', bytes: meshy },
      format: 'obj',
      includeTextures: false,
      textures: [],
      basename: 'moved',
    });
    const zip = await JSZip.loadAsync(result.data);
    const obj = await zip.file('moved.obj')!.async('string');
    const firstV = obj.match(/^v (\S+) (\S+) (\S+)$/m)!;
    expect(Number(firstV[1])).toBeCloseTo(10, 5);
    expect(Number(firstV[2])).toBeCloseTo(0, 5);
  });
});

describe('texture embedding into GLB', () => {
  it('attaches a single texture and creates a default material when none exists', async () => {
    const glb = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const parsed = parseGlb(glb);
    const outcome = embedTextures(parsed.json, parsed.bin, [
      { name: 'texture_0.png', bytes: tinyPng(), mimeType: 'image/png' },
    ]);
    expect(outcome.kind).toBe('attached');
    if (outcome.kind !== 'attached') return;
    const result = parseGlb(outcome.glb);
    expect(result.json.images).toHaveLength(1);
    expect(result.json.images![0]!.mimeType).toBe('image/png');
    expect(result.json.textures).toHaveLength(1);
    expect(result.json.materials!.at(-1)!.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
    // Embedded bytes round-trip.
    const image = result.json.images![0]!;
    const view = result.json.bufferViews![image.bufferView!]!;
    const stored = result.bin.slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    expect(stored.byteLength).toBe(tinyPng().byteLength);
  });

  it('refuses to attach textures to UV-less geometry', async () => {
    const glb = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const parsed = parseGlb(glb);
    delete parsed.json.meshes![0]!.primitives[0]!.attributes.TEXCOORD_0;
    const outcome = embedTextures(parsed.json, parsed.bin, [
      { name: 'texture_0.png', bytes: tinyPng(), mimeType: 'image/png' },
    ]);
    expectSkipped(outcome, 'no-uv');
  });

  it('rejects invalid image payloads', async () => {
    const glb = await buildMeshoptGlb({ meshes: [quadMesh()] });
    const parsed = parseGlb(glb);
    const notAnImage = new Uint8Array(16).buffer;
    const outcome = embedTextures(parsed.json, parsed.bin, [
      { name: 'texture_0.png', bytes: notAnImage, mimeType: 'image/png' },
    ]);
    expectSkipped(outcome, 'invalid-images');
  });

  it('sniffs png/jpeg/webp magic bytes', () => {
    expect(sniffImageMime(tinyPng())).toBe('image/png');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(sniffImageMime(jpeg.buffer)).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array(8).buffer)).toBeNull();
  });
});

describe('GLB exporter', () => {
  it('embeds textures into a decoded GLB and re-validates', async () => {
    const meshy = await synthMeshy();
    const decoded = await decoderRegistry.getForBytes(meshy)!.decode(meshy);
    const exporter = exporterRegistry.get('glb')!;
    const result = await exporter.export(decoded, {
      includeTextures: true,
      textures: [{ name: 'texture_0.png', bytes: tinyPng(), mimeType: 'image/png' }],
      basename: 'quad',
    });
    expect(result.filename).toBe('quad.glb');
    const parsed = parseGlb(result.data);
    expect(parsed.json.images?.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).not.toContain('no UV'); // quad has UVs
  });

  it('warns (honestly) when no texture is available', async () => {
    const meshy = await synthMeshy();
    const decoded = await decoderRegistry.getForBytes(meshy)!.decode(meshy);
    const exporter = exporterRegistry.get('glb')!;
    const result = await exporter.export(decoded, { includeTextures: true, textures: [], basename: 'quad' });
    expect(result.warnings.some((w) => w.includes('no texture was available'))).toBe(true);
  });
});

describe('scene math', () => {
  it('translation-only TRS matches identity rotation', () => {
    const m = fromTRS({ translation: [5, 6, 7] } as GlbNode);
    const p = transformPoint(m, [1, 0, 0]);
    expect(p).toEqual([6, 6, 7]);
  });

  it('rotates 90° about Z correctly', () => {
    const halfSqrt2 = Math.SQRT1_2;
    const m = fromTRS({ rotation: [0, 0, halfSqrt2, halfSqrt2] } as GlbNode);
    const p = transformPoint(m, [1, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(1, 6);
  });

  it('composes parent × child', () => {
    const parent = fromTRS({ translation: [1, 0, 0] } as GlbNode);
    const child = fromTRS({ translation: [0, 1, 0] } as GlbNode);
    const world = matMul(parent, child);
    const p = transformPoint(world, [0, 0, 0]);
    expect(p).toEqual([1, 1, 0]);
  });

  it('normal matrix of identity is identity', () => {
    const n = normalMatrix(identity4());
    expect(transformPoint(n, [0.5, 0.25, 1])).toEqual([0.5, 0.25, 1]);
  });
});
