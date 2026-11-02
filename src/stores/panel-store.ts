/**
 * Side Panel application state (Zustand).
 * Tab-scoped: models from the active tab only; manual imports are kept
 * separate and never mixed with auto-detected data.
 */

import { create } from 'zustand';
import type {
  ConversionJob,
  ExportFormat,
  NormalizedModel,
  ProviderId,
  TextureInput,
} from '@/core/models/types';
import { pluginRegistry } from '@/plugins/registry';
import { persist, createJSONStorage } from 'zustand/middleware';

export type DetectionStatus =
  | 'unknown'
  | 'unsupported-site'
  | 'plugin-disabled'
  | 'supported-idle'
  | 'observing'
  | 'detected'
  | 'manual';

export interface LocalImport {
  name: string;
  bytes: ArrayBuffer;
  kind: 'meshy' | 'glb' | 'drc';
  textures: TextureInput[];
}

export interface ManualJsonModel {
  model: NormalizedModel;
  variantId: string;
}

interface PanelState {
  /* Tab context */
  activeTabId?: number;
  tabUrl?: string;
  supported: boolean;
  pluginEnabled: boolean;
  providerId?: ProviderId;
  observing: boolean;
  models: NormalizedModel[];
  detectionStatus: DetectionStatus;

  /* Selections (persisted where sensible) */
  selectedModelId?: string;
  selectedVariantId?: string;
  format: ExportFormat;
  includeTextures: boolean;

  /* Manual import */
  localImport?: LocalImport;
  manualModels: NormalizedModel[];

  /* Conversion */
  job?: ConversionJob;
  jobWarnings: string[];
  lastSaved?: { filename: string; at: number; warnings: string[] };
  importDialogOpen: boolean;
  settingsOpen: boolean;

  /* Actions */
  applyTabState: (state: {
    tabId?: number;
    url?: string;
    supported: boolean;
    pluginEnabled?: boolean;
    providerId?: ProviderId;
    models: NormalizedModel[];
    observing: boolean;
  }) => void;
  clearModelsForTab: (tabId: number) => void;
  selectModel: (id: string) => void;
  selectVariant: (id: string) => void;
  setFormat: (format: ExportFormat) => void;
  setIncludeTextures: (value: boolean) => void;
  setLocalImport: (imp?: LocalImport) => void;
  addManualModel: (model: NormalizedModel) => void;
  clearManual: () => void;
  setJob: (job?: ConversionJob) => void;
  patchJob: (patch: Partial<ConversionJob>) => void;
  setJobWarnings: (warnings: string[]) => void;
  setLastSaved: (info: { filename: string; at: number; warnings: string[] }) => void;
  setImportDialogOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
}

const normalizeFormat = (format: ExportFormat, providerId?: ProviderId): ExportFormat => {
  const provider = pluginRegistry.get(providerId);
  if (!provider) return format;
  return provider.capabilities.supportedExports.includes(format) ? format : (provider.capabilities.supportedExports[0] ?? 'original');
};

export const usePanelStore = create<PanelState>()(
  persist(
    (set, get) => ({
      supported: false,
      pluginEnabled: true,
      observing: false,
      models: [],
      detectionStatus: 'unknown',
      format: 'glb',
      includeTextures: true,
      manualModels: [],
      jobWarnings: [],
      importDialogOpen: false,
      settingsOpen: false,

      applyTabState: ({ tabId, url, supported, pluginEnabled = true, providerId, models, observing }) => {
        const state = get();
        const manual = state.manualModels.length > 0 || !!state.localImport;
        // Keep selection if the model survived the update; otherwise reset.
        const stillThere = models.some((m) => m.id === state.selectedModelId);
        const model = stillThere ? models.find((m) => m.id === state.selectedModelId) : models[0];
        const provider = pluginRegistry.get(providerId);
        const preferred = model && provider ? provider.preferVariant(model) : undefined;
        const variantStillThere = model?.variants.some((v) => v.id === state.selectedVariantId);
        const selectedManual = !!state.localImport || state.manualModels.some((item) => item.id === state.selectedModelId);
        const detectionStatus: DetectionStatus = manual
          ? 'manual'
          : !supported
            ? 'unsupported-site'
            : !pluginEnabled
              ? 'plugin-disabled'
            : models.length > 0
              ? 'detected'
              : observing
                ? 'observing'
                : 'supported-idle';
        set({
          activeTabId: tabId ?? state.activeTabId,
          tabUrl: url,
          supported,
          pluginEnabled,
          providerId,
          models,
          observing,
          detectionStatus,
          selectedModelId: selectedManual ? state.selectedModelId : model?.id,
          selectedVariantId: selectedManual || variantStillThere ? state.selectedVariantId : preferred?.id,
          format: state.localImport ? state.format : normalizeFormat(state.format, selectedManual ? state.manualModels.find((item) => item.id === state.selectedModelId)?.provider : providerId),
        });
      },

      clearModelsForTab: (tabId) => {
        if (get().activeTabId !== tabId) return;
        set({ models: [], detectionStatus: get().localImport || get().manualModels.length ? 'manual' : 'unknown' });
      },

      selectModel: (id) => {
        const state = get();
        const model = state.models.find((m) => m.id === id) ?? state.manualModels.find((m) => m.id === id);
        const provider = pluginRegistry.get(model?.provider);
        set({ selectedModelId: id, selectedVariantId: provider && model ? provider.preferVariant(model)?.id : model?.variants[0]?.id });
      },

      selectVariant: (id) => set({ selectedVariantId: id }),

      setFormat: (format) => {
        const state = get();
        set({ format: state.localImport ? format : normalizeFormat(format, selectCurrentModel(state)?.provider ?? state.providerId) });
      },
      setIncludeTextures: (value) => set({ includeTextures: value }),

      setLocalImport: (imp) =>
        set({ localImport: imp, detectionStatus: imp ? 'manual' : get().detectionStatus === 'manual' && get().manualModels.length === 0 ? 'unknown' : get().detectionStatus }),

      addManualModel: (model) => {
        const provider = pluginRegistry.get(model.provider);
        set({
          manualModels: [...get().manualModels.filter((m) => m.id !== model.id), model],
          selectedModelId: model.id,
          selectedVariantId: provider?.preferVariant(model)?.id ?? model.variants[0]?.id,
          detectionStatus: 'manual',
        });
      },

      clearManual: () =>
        set({ manualModels: [], localImport: undefined, detectionStatus: get().models.length ? 'detected' : get().supported ? get().pluginEnabled ? 'supported-idle' : 'plugin-disabled' : 'unknown', selectedModelId: get().models[0]?.id }),

      setJob: (job) => set({ job, jobWarnings: job ? [] : get().jobWarnings }),
      patchJob: (patch) => {
        const job = get().job;
        if (!job) return;
        set({ job: { ...job, ...patch, updatedAt: Date.now() } });
      },
      setJobWarnings: (warnings) => set({ jobWarnings: warnings }),
      setLastSaved: (info) => set({ lastSaved: info }),
      setImportDialogOpen: (open) => set({ importDialogOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
    }),
    {
      name: 'modelport:panel',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ format: state.format, includeTextures: state.includeTextures }),
    },
  ),
);

/** The model the UI is currently working with. */
export function selectCurrentModel(state: PanelState): NormalizedModel | undefined {
  if (state.localImport) {
    return {
      provider: 'local',
      id: `local:${state.localImport.name}`,
      name: state.localImport.name.replace(/\.[a-z0-9]+$/i, ''),
      status: 'succeeded',
      variants: [
        {
          id: 'local:file',
          kind: state.localImport.kind === 'meshy' ? 'textured' : 'generated',
          label: `Local .${state.localImport.kind} file`,
          status: 'succeeded',
          assets: [{ id: 'local:bytes', kind: 'model', format: state.localImport.kind, bytes: state.localImport.bytes }],
          textures: state.localImport.textures.map((t, i) => ({ id: `local:tex${i}`, role: 'baseColor' as const, bytes: t.bytes, filename: t.name, mimeType: t.mimeType })),
        },
      ],
      provenance: { source: 'local-file', detectedAt: Date.now() },
    };
  }
  const pool = [...state.models, ...state.manualModels];
  return pool.find((m) => m.id === state.selectedModelId) ?? pool[0];
}
