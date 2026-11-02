/**
 * Per-tab model state in the background service worker.
 * Models from different tabs never mix; navigation clears a tab's models.
 */

import type { NormalizedModel, ProviderId } from '@/core/models/types';
import { pluginRegistry } from '@/plugins/registry';

export interface TabState {
  providerId?: ProviderId;
  /** Last known page URL (from content-script reports). */
  url?: string;
  /** Content script announced itself on this tab. */
  observing: boolean;
  models: Map<string, NormalizedModel>;
  updatedAt: number;
}

export class TabStore {
  private readonly tabs = new Map<number, TabState>();

  get(tabId: number | undefined): TabState | undefined {
    return tabId === undefined ? undefined : this.tabs.get(tabId);
  }

  tabIds(): number[] { return [...this.tabs.keys()]; }

  ensure(tabId: number): TabState {
    let state = this.tabs.get(tabId);
    if (!state) {
      state = { observing: false, models: new Map(), updatedAt: Date.now() };
      this.tabs.set(tabId, state);
    }
    return state;
  }

  markObserving(tabId: number, providerId: ProviderId, url?: string): TabState {
    const state = this.ensure(tabId);
    state.observing = true;
    state.providerId = providerId;
    if (url) state.url = url;
    state.updatedAt = Date.now();
    return state;
  }

  noteUrl(tabId: number, url: string): TabState {
    const state = this.ensure(tabId);
    state.url = url;
    state.updatedAt = Date.now();
    return state;
  }

  /** Merge a normalized model into its tab, grouped by model.id. */
  async upsertModel(tabId: number, model: NormalizedModel): Promise<NormalizedModel> {
    const provider = pluginRegistry.get(model.provider);
    if (!provider) throw new Error(`unknown provider ${model.provider}`);
    const state = this.ensure(tabId);
    state.providerId = model.provider;
    const existing = state.models.get(model.id);
    const merged = existing ? provider.mergeTask(existing, model) : model;
    const resolved = await provider.resolveAssets(merged);
    state.models.set(resolved.id, resolved);
    state.updatedAt = Date.now();
    return resolved;
  }

  resetModels(tabId: number): void {
    const state = this.tabs.get(tabId);
    if (!state) return;
    state.models.clear();
    state.observing = false;
    state.providerId = undefined;
    state.url = undefined;
    state.updatedAt = Date.now();
  }

  listModels(tabId: number | undefined): NormalizedModel[] {
    const state = this.get(tabId);
    if (!state) return [];
    const pageTaskId = state.url ? pluginRegistry.get(state.providerId)?.modelIdFromPage?.(state.url) : null;
    return [...state.models.values()]
      .filter((model) => !pageTaskId || model.id === pageTaskId || model.rootId === pageTaskId || model.variants.some((variant) => variant.sourceTaskId === pageTaskId))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  delete(tabId: number): void {
    this.tabs.delete(tabId);
  }
}
