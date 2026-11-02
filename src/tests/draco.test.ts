import { describe, expect, it, vi } from 'vitest';
import { createEncoderModule } from 'draco3d';
import JSZip from 'jszip';
import { convertModel } from '@/conversion/pipeline';
import { dracoToGlb, isDracoBytes } from '@/conversion/draco/decode';
import { parseGlb } from '@/conversion/glb/container';
import { AccessorReader } from '@/conversion/gltf/accessors';
import { verifyGlbWithThree } from '@/features/conversion/verify';
import { decoderRegistry } from '@/conversion/decoder-registry';

vi.mock('@/conversion/draco/module', async () => {
  const { createDecoderModule } = await import('draco3d');
  let pending: ReturnType<typeof createDecoderModule> | undefined;
  return { getDracoModule: () => pending ??= createDecoderModule() };
});

async function buildDraco(attributes = true): Promise<ArrayBuffer> {
  const module = await createEncoderModule();
  const builder = new module.MeshBuilder(), mesh = new module.Mesh(), encoder = new module.Encoder(), encoded = new module.DracoInt8Array();
  try {
    builder.AddFloatAttribute(mesh, module.POSITION, 4, 3, new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0]));
    builder.AddFacesToMesh(mesh, 2, new Uint32Array([0,1,2, 0,2,3]));
    if (attributes) {
      builder.AddFloatAttribute(mesh, module.NORMAL, 4, 3, new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]));
      builder.AddFloatAttribute(mesh, module.TEX_COORD, 4, 2, new Float32Array([0,0, 1,0, 1,1, 0,1]));
      builder.AddFloatAttribute(mesh, module.COLOR, 4, 3, new Float32Array([1,0,0, 1,0,0, 1,0,0, 1,0,0]));
    }
    encoder.SetSpeedOptions(5, 5);
    const length = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
    expect(length).toBeGreaterThan(0);
    const bytes = new Uint8Array(length);
    for (let i=0;i<length;i++) bytes[i] = encoded.GetValue(i);
    return bytes.buffer;
  } finally { for (const value of [encoded, encoder, mesh, builder]) module.destroy(value); }
}

describe('standalone Draco conversion', () => {
  it('creates an ordinary GLB with preserved geometry and vertex attributes', async () => {
    const source = await buildDraco();
    expect(isDracoBytes(source)).toBe(true);
    expect(decoderRegistry.getForBytes(source)?.id).toBe('draco');
    const result = await convertModel({ source: { name: 'quad.drc', bytes: source }, format: 'glb', includeTextures: false, textures: [], basename: 'quad' });
    expect(result.stats).toMatchObject({ vertices: 4, triangles: 2, hasNormals: true, hasUvs: true, hasTextures: false });
    const parsed = parseGlb(result.data);
    expect(parsed.json.extensionsRequired ?? []).not.toContain('KHR_draco_mesh_compression');
    const primitive = parsed.json.meshes![0]!.primitives[0]!;
    const reader = new AccessorReader(parsed);
    expect(parsed.json.accessors![primitive.attributes.POSITION!]!).toMatchObject({ min: [0,0,0], max: [1,1,0], componentType: 5126 });
    expect([...reader.readFloats(primitive.attributes.NORMAL)!]).toEqual([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
    expect([...reader.readFloats(primitive.attributes.COLOR_0)!]).toEqual([1,0,0, 1,0,0, 1,0,0, 1,0,0]);
    expect(reader.readIndices(primitive.indices)).toHaveLength(6);
    expect(await verifyGlbWithThree(result.data)).toMatchObject({ meshes: 1, triangles: 2, hasTextures: false });
  });

  it('converts position-only geometry without inventing texture coordinates or materials', async () => {
    const source = await buildDraco(false);
    const parsed = parseGlb(await dracoToGlb(source));
    expect(parsed.json.meshes![0]!.primitives[0]!.attributes).toEqual({ POSITION: 0 });
    expect(parsed.json.materials).toBeUndefined();
    expect(parsed.json.images).toBeUndefined();
  });

  it('exports decoded Rodin-style geometry as OBJ through the shared exporter', async () => {
    const bytes = await buildDraco(false);
    const result = await convertModel({ source: { name: 'quad.drc', bytes }, format: 'obj', includeTextures: false, textures: [], basename: 'quad' });
    const zip = await JSZip.loadAsync(result.data);
    const obj = await zip.file('quad.obj')!.async('string');
    expect(obj.split('\n').filter(line => line.startsWith('f '))).toHaveLength(2);
    expect(result.stats).toMatchObject({ vertices: 4, triangles: 2 });
  });

  it('keeps original downloads as .drc without decoding them', async () => {
    const bytes = await buildDraco(false);
    const result = await convertModel({ source: { name: 'unknown', bytes }, format: 'original', includeTextures: false, textures: [], basename: 'model' });
    expect(result.filename).toBe('model.drc');
    expect(result.data).toBe(bytes);
  });

  it('rejects malformed or truncated Draco input cleanly', async () => {
    await expect(dracoToGlb(new Uint8Array([1,2,3]).buffer)).rejects.toMatchObject({ code: 'MODEL_DECODE_FAILED' });
    const bytes = await buildDraco();
    await expect(dracoToGlb(bytes.slice(0, 15))).rejects.toMatchObject({ code: 'MODEL_DECODE_FAILED' });
  });

  it('rejects point-cloud geometry with a specific explanation', async () => {
    const bytes = await buildDraco(false);
    new Uint8Array(bytes)[7] = 0; // Draco geometry-type header: POINT_CLOUD.
    await expect(dracoToGlb(bytes)).rejects.toThrow('point cloud');
  });
});
