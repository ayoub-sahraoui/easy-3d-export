/**
 * Zod schemas for Meshy task payloads (public web API shape).
 *
 * Two encodings occur in the wild:
 *  - envelope: { code: "OK", result: { …task } }
 *  - bare task: { id, name, status, rootId, … }
 * Both are accepted; `result.result.*.modelUrl` is the asset source of truth.
 */

import { z } from 'zod';

const sectionSchema = z
  .object({
    modelUrl: z.string().optional(),
    quadJsonUrl: z.string().optional(),
    textureUrls: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
  })
  .passthrough();

export const meshyTaskSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    status: z.string().optional(),
    progress: z.number().optional(),
    phase: z.string().optional(),
    mode: z.string().optional(),
    rootId: z.string().optional(),
    parent: z.string().optional(),
    taskType: z.string().optional(),
    triangleCount: z.number().optional(),
    vertexCount: z.number().optional(),
    topology: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    result: z
      .object({
        previewUrl: z.string().optional(),
        generate: sectionSchema.nullish().optional(),
        texture: sectionSchema.nullish().optional(),
        remesh: sectionSchema.nullish().optional(),
        draft: sectionSchema.nullish().optional(),
        stylize: sectionSchema.nullish().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const meshyEnvelopeSchema = z
  .object({
    code: z.string().optional(),
    result: meshyTaskSchema,
  })
  .passthrough();

export type MeshyTask = z.infer<typeof meshyTaskSchema>;
export type MeshyEnvelope = z.infer<typeof meshyEnvelopeSchema>;

/** Section keys that can carry model assets, in provider preference order. */
export const ASSET_SECTIONS = ['texture', 'generate', 'remesh', 'draft', 'stylize'] as const;
export type AssetSection = (typeof ASSET_SECTIONS)[number];

/** Parse either encoding into a task; null when the payload is unrelated. */
export function parseMeshyTask(payload: unknown): MeshyTask | null {
  if (typeof payload !== 'object' || payload === null) return null;
  // Envelope first; fall back to a bare task object.
  const envelope = meshyEnvelopeSchema.safeParse(payload);
  if (envelope.success) return envelope.data.result;
  const task = meshyTaskSchema.safeParse(payload);
  return task.success ? task.data : null;
}

/**
 * Structural recognition gate. Being conservative here keeps unrelated JSON
 * (arbitrary API responses on meshy.ai) out of the pipeline.
 */
export function isMeshyTaskLike(task: MeshyTask | null): task is MeshyTask {
  if (!task) return false;
  const hasAsset =
    ASSET_SECTIONS.some((key) => {
      const section = task.result?.[key];
      return !!section && (!!section.modelUrl || !!section.quadJsonUrl || !!section.textureUrls?.length);
    }) || !!task.result?.previewUrl;
  const knownPhase = ['generate', 'texture', 'remesh', 'draft', 'stylize'].includes(task.phase ?? '');
  const plausiblyTask = typeof task.rootId === 'string' && task.rootId.length > 0 && typeof task.status === 'string';
  return hasAsset || knownPhase || plausiblyTask;
}

/** Which section a task's outputs live in, determined by its phase/mode. */
export function activeSectionForTask(task: MeshyTask): AssetSection | null {
  const phase = (task.phase ?? '').toLowerCase();
  const mode = (task.mode ?? '').toLowerCase();
  const hasData = (key: AssetSection) => {
    const section = task.result?.[key];
    return !!section && (!!section.modelUrl || !!section.quadJsonUrl || !!section.textureUrls?.length);
  };
  const pick = (candidates: AssetSection[]): AssetSection | null =>
    candidates.find(hasData) ?? candidates[0] ?? null;

  if (phase === 'texture' || mode === 'texture') return pick(['texture']);
  if (phase === 'remesh' || mode === 'remesh') return pick(['remesh']);
  if (phase === 'stylize' || mode === 'stylize') return pick(['stylize']);
  if (phase === 'generate' || phase === 'draft' || mode === 'draft') {
    return pick(['generate', 'draft']);
  }
  // Fall back to whichever section actually carries data.
  return pick([...ASSET_SECTIONS]);
}
