/**
 * Easy 3D Export core domain types.
 *
 * These contracts sit between three layers:
 *  - Provider plugins normalize their
 *    provider-specific JSON into NormalizedModel.
 *  - The conversion engine operates on file *formats*, never provider brands.
 *  - The Side Panel renders NormalizedModel and drives ConversionJobs.
 *
 * Keep this file free of provider-specific field paths.
 */

/** Plugin IDs are open-ended; `local` is reserved for imported files. */
export type ProviderId = string;

/** Formats the UI can offer. `original` = pass-through of the provider asset. */
export type ExportFormat = 'original' | 'glb' | 'obj';

/** Where a detection came from — used for honest UI labels. */
export type DetectionProvenance =
  | 'page-scan'
  | 'network-response'
  | 'json-document'
  | 'manual-json'
  | 'url-import'
  | 'local-file';

export type ModelStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'unknown';

export type AssetKind = 'model' | 'texture' | 'preview' | 'geometry';

/** A single downloadable binary the provider exposes. */
export interface ModelAsset {
  id: string;
  kind: AssetKind;
  /** Lowercase extension without dot, e.g. `meshy`, `png`, `json`. */
  format: string;
  url?: string;
  /** In-memory bytes for locally imported assets. */
  bytes?: ArrayBuffer;
  filename?: string;
  mimeType?: string;
  /** Expiry of the signed URL, in epoch ms, when the provider exposes one. */
  expiresAt?: number;
}

export type TextureRole =
  | 'baseColor'
  | 'normal'
  | 'roughness'
  | 'metallic'
  | 'ao'
  | 'unknown';

export interface TextureAsset {
  id: string;
  role: TextureRole;
  url?: string;
  bytes?: ArrayBuffer;
  filename?: string;
  mimeType?: string;
  expiresAt?: number;
}

export type VariantKind = 'generated' | 'textured' | 'remeshed' | 'unknown';

/**
 * One deliverable version of a model — e.g. Meshy's geometry task and its
 * follow-up texture task are two variants of the same root model.
 */
export interface ModelVariant {
  id: string;
  kind: VariantKind;
  label: string;
  status: ModelStatus;
  sourceTaskId?: string;
  phase?: string;
  assets: ModelAsset[];
  textures: TextureAsset[];
  triangles?: number;
  vertices?: number;
}

export interface NormalizedModel {
  provider: ProviderId;
  /** Stable grouping id (e.g. Meshy rootId); falls back to task id. */
  id: string;
  rootId?: string;
  parentId?: string;

  name: string;
  status: ModelStatus;

  previewUrl?: string;
  geometry?: {
    triangles?: number;
    vertices?: number;
    topology?: string;
  };

  variants: ModelVariant[];
  license?: string;
  createdAt?: number;
  updatedAt?: number;

  /** How/when this model was last observed. */
  provenance?: {
    source: DetectionProvenance;
    url?: string;
    detectedAt: number;
  };
}

export interface ProviderCapabilities {
  automaticDetection: boolean;
  localConversion: boolean;
  textures: boolean;
  originalDownload: boolean;
  supportedExports: ExportFormat[];
}

/** Raw provider payload recognition + normalization contract. */
export interface ModelProvider {
  id: ProviderId;
  displayName: string;
  /** Origins the content scripts are scoped to. */
  supportedOrigins: string[];
  capabilities: ProviderCapabilities;

  matchesUrl(url: URL): boolean;
  /** Current model task, when the provider's workspace URL identifies one. */
  modelIdFromPage?(url: string): string | null;
  /** Cheap structural check whether a JSON payload is relevant. */
  recognizesPayload(payload: unknown): boolean;
  /** Parse + normalize a provider payload. Returns null if not recognized. */
  normalize(payload: unknown, provenance?: NormalizedModel['provenance']): NormalizedModel | null;
  /**
   * Merge a newly observed task into an existing grouped model
   * (same root). Returns a new object; may reuse unchanged substructures.
   */
  mergeTask(existing: NormalizedModel, incoming: NormalizedModel): NormalizedModel;
  /** Prefer this order of variants when picking a default selection. */
  preferVariant(model: NormalizedModel): ModelVariant | undefined;
  /** Fill derived fields (filenames, expiry) — network-free enrichment. */
  resolveAssets(model: NormalizedModel): Promise<NormalizedModel>;
}

/* ------------------------------------------------------------------ */
/* Conversion engine contracts (format-based, provider-independent)    */
/* ------------------------------------------------------------------ */

/** What a decoder produced: a validated, self-contained GLB. */
export interface DecodedModel {
  sourceFormat: string;
  /** Standalone GLB bytes (meshopt resolved, no external buffers). */
  glb: ArrayBuffer;
  stats: {
    meshCount: number;
    triangles: number;
    vertices: number;
    hasNormals: boolean;
    hasUvs: boolean;
    hasTextures: boolean;
    materials: number;
  };
  warnings: string[];
}

export interface DecodeOptions {
  /** Hard cap on decoded output size. */
  maxBytes?: number;
  /** Progress hook for decode sub-stages. */
  onStage?: (stage: 'decoding' | 'decompressing') => void;
}

export interface ModelDecoder {
  id: string;
  /** File extensions (no dot) this decoder claims. */
  extensions: string[];
  canDecode(file: ArrayBuffer | Uint8Array): boolean | Promise<boolean>;
  decode(file: ArrayBuffer, options?: DecodeOptions): Promise<DecodedModel>;
}

export interface ExportCapabilities {
  geometry: boolean;
  uv: boolean;
  textures: boolean;
  materials: boolean;
  animation: boolean;
  vertexColors: boolean;
}

export interface TextureInput {
  name: string;
  bytes: ArrayBuffer;
  /** Sniffed mime: image/png | image/jpeg | ... */
  mimeType: string;
}

export interface ExportOptions {
  includeTextures: boolean;
  /** External textures supplied by the caller (already downloaded). */
  textures?: TextureInput[];
  /** Base name (no extension) for outputs. */
  basename: string;
}

/** Logical file inside an export (manifest entry). */
export interface ExportedFileManifest {
  path: string;
  mimeType: string;
  byteLength: number;
}

export interface ExportResult {
  format: string;
  /** The single artifact the user saves: a .glb file, or the ZIP for multi-file exports. */
  filename: string;
  data: ArrayBuffer;
  mimeType: string;
  /** Logical contents when `packaged` (paths relative to the archive root). */
  files: ExportedFileManifest[];
  /** True when data is an archive containing `files`. */
  packaged: boolean;
  warnings: string[];
  stats?: DecodedModel['stats'];
}

export interface ModelExporter {
  format: string;
  label: string;
  capabilities: ExportCapabilities;
  export(model: DecodedModel, options: ExportOptions): Promise<ExportResult>;
}

/* ------------------------------------------------------------------ */
/* Conversion job (UI-facing progress model)                           */
/* ------------------------------------------------------------------ */

export type ConversionStage =
  | 'idle'
  | 'downloading'
  | 'decoding'
  | 'decompressing'
  | 'exporting'
  | 'saving'
  | 'done'
  | 'error'
  | 'cancelled';

export interface ConversionJob {
  id: string;
  modelId: string;
  variantId: string;
  format: ExportFormat;
  includeTextures: boolean;
  stage: ConversionStage;
  stageDetail?: string;
  /** 0..100 when measurable (byte downloads); undefined = indeterminate. */
  progress?: number;
  startedAt: number;
  updatedAt: number;
  error?: { code: string; message: string; origin?: string };
  resultFilename?: string;
}
