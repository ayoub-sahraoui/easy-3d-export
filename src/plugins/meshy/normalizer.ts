/**
 * Meshy task → NormalizedModel, and rootId-based task grouping.
 *
 * Interpretation rules (from integration research):
 *  - `phase: "generate"` = geometry task; `phase: "texture"` = follow-up
 *    texturing task; both share `rootId`.
 *  - The texture task has its own task id and may report a different vertex
 *    count at the same triangle count.
 *  - The output field is chosen by the task phase, never by request args.
 *  - `status: "SUCCEEDED"` outranks a possibly stale `progress: 0`.
 *  - `autoTexture: true` in args is a request option, not proof of textures.
 *  - `enablePBR: false` means full PBR maps must not be assumed.
 */

import type {
  ModelStatus,
  ModelVariant,
  NormalizedModel,
  VariantKind,
} from '@/core/models/types';
import {
  activeSectionForTask,
  isMeshyTaskLike,
  parseMeshyTask,
  type AssetSection,
  type MeshyTask,
} from './schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapStatus(raw: string | undefined): ModelStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'SUCCEEDED':
    case 'SUCCESS':
    case 'DONE':
      return 'succeeded';
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELED':
    case 'CANCELLED':
      return 'failed';
    case 'PENDING':
    case 'QUEUED':
    case 'CREATED':
      return 'pending';
    case 'RUNNING':
    case 'PROCESSING':
    case 'GENERATING':
    case 'TEXTURING':
      return 'processing';
    default:
      return 'unknown';
  }
}

function kindForSection(section: AssetSection): VariantKind {
  switch (section) {
    case 'texture':
      return 'textured';
    case 'remesh':
      return 'remeshed';
    case 'generate':
    case 'draft':
      return 'generated';
    default:
      return 'unknown';
  }
}

function labelFor(kind: VariantKind): string {
  switch (kind) {
    case 'textured':
      return 'Textured Model';
    case 'generated':
      return 'Generated Geometry';
    case 'remeshed':
      return 'Remeshed';
    default:
      return 'Variant';
  }
}

function sectionTextureRoles(section: NonNullable<NonNullable<MeshyTask['result']>[AssetSection]>): {
  role: 'baseColor' | 'unknown';
  url: string;
}[] {
  const out: { role: 'baseColor' | 'unknown'; url: string }[] = [];
  for (const entry of section.textureUrls ?? []) {
    const record = entry as Record<string, unknown>;
    const color = typeof record.colorMapUrl === 'string' ? record.colorMapUrl : undefined;
    if (color) out.push({ role: 'baseColor', url: color });
  }
  return out;
}

/** Normalize a single Meshy task payload. Null when not a Meshy task. */
export function normalizeMeshyTask(
  payload: unknown,
  provenance?: NormalizedModel['provenance'],
): NormalizedModel | null {
  const task = parseMeshyTask(payload);
  if (!isMeshyTaskLike(task)) return null;

  const rootId = task.rootId && task.rootId.length > 0 ? task.rootId : task.id;
  const name = task.name?.trim() || `Meshy model ${rootId.slice(0, 8)}`;
  const section = activeSectionForTask(task);
  const kind: VariantKind = section ? kindForSection(section) : 'unknown';
  const status = mapStatus(task.status);

  const variant: ModelVariant = {
    id: `${task.id}:${section ?? 'task'}`,
    kind,
    label: labelFor(kind),
    status,
    sourceTaskId: task.id,
    phase: task.phase,
    assets: [],
    textures: [],
    triangles: task.triangleCount,
    vertices: task.vertexCount,
  };

  const sectionData = section ? task.result?.[section] : undefined;
  if (sectionData?.modelUrl) {
    variant.assets.push({
      id: `${task.id}:model`,
      kind: 'model',
      format: 'meshy',
      url: sectionData.modelUrl,
    });
  }
  if (sectionData?.quadJsonUrl) {
    variant.assets.push({
      id: `${task.id}:quads`,
      kind: 'geometry',
      format: 'json',
      url: sectionData.quadJsonUrl,
    });
  }
  if (task.result?.previewUrl) {
    variant.assets.push({
      id: `${task.id}:preview`,
      kind: 'preview',
      format: 'png',
      url: task.result.previewUrl,
    });
  }
  for (const [i, tex] of sectionTextureRoles(sectionData ?? {}).entries()) {
    variant.textures.push({
      id: `${task.id}:tex${i}`,
      role: tex.role,
      url: tex.url,
    });
  }

  const model: NormalizedModel = {
    provider: 'meshy',
    id: rootId,
    rootId,
    parentId: task.parent && task.parent.length > 0 ? task.parent : undefined,
    name,
    status,
    previewUrl: task.result?.previewUrl,
    variants: [variant],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    provenance: provenance ?? {
      source: 'manual-json',
      detectedAt: Date.now(),
    },
  };
  return model;
}

/** Grouping key: rootId relationship (falls back to task id). */
export function meshyGroupKey(model: NormalizedModel): string {
  return model.rootId ?? model.id;
}

/**
 * Merge a later-observed task into an existing grouped model.
 * Same-variant-id replaces; new phases append as extra variants.
 */
export function mergeMeshyTask(existing: NormalizedModel, incoming: NormalizedModel): NormalizedModel {
  const variants = [...existing.variants];
  for (const variant of incoming.variants) {
    const index = variants.findIndex((v) => v.id === variant.id);
    if (index >= 0) variants[index] = variant;
    else variants.push(variant);
  }
  // Stable, readable ordering: textured first, then remeshed, generated, unknown.
  const order: Record<VariantKind, number> = { textured: 0, remeshed: 1, generated: 2, unknown: 3 };
  variants.sort((a, b) => order[a.kind] - order[b.kind]);

  const succeeded = variants.some((v) => v.status === 'succeeded');
  const processing = variants.some((v) => v.status === 'processing' || v.status === 'pending');
  const failed = !succeeded && variants.every((v) => v.status === 'failed');

  const preferred = preferMeshyVariant({ ...incoming, variants }) ?? variants[0];

  return {
    ...existing,
    name: incoming.name || existing.name,
    status: processing ? 'processing' : failed ? 'failed' : succeeded ? 'succeeded' : 'unknown',
    previewUrl: incoming.previewUrl ?? existing.previewUrl,
    variants,
    geometry: preferred
      ? {
          triangles: preferred.triangles ?? existing.geometry?.triangles,
          vertices: preferred.vertices ?? existing.geometry?.vertices,
          topology: existing.geometry?.topology,
        }
      : existing.geometry,
    updatedAt: Math.max(existing.updatedAt ?? 0, incoming.updatedAt ?? 0),
    provenance: incoming.provenance ?? existing.provenance,
  };
}

/**
 * Default-selection preference: the latest *successful textured* variant,
 * then successful remeshed, then successful generated; fall back to whatever
 * carries a downloadable model asset.
 */
export function preferMeshyVariant(model: NormalizedModel): ModelVariant | undefined {
  const rank = (v: ModelVariant) =>
    v.status === 'succeeded' ? 0 : v.status === 'processing' || v.status === 'pending' ? 1 : 2;
  const kindRank: Record<VariantKind, number> = { textured: 0, remeshed: 1, generated: 2, unknown: 3 };
  const hasModel = (v: ModelVariant) => v.assets.some((a) => a.kind === 'model');
  const candidates = model.variants.filter((v) => hasModel(v) || v.status === 'succeeded');
  if (candidates.length === 0) return model.variants[0];
  return [...candidates].sort((a, b) => rank(a) - rank(b) || kindRank[a.kind] - kindRank[b.kind])[0];
}

export { UUID_RE };
