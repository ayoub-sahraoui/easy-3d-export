/**
 * Strongly typed messages between extension contexts.
 *
 * Trust boundaries:
 *  - Page/main-world data is DATA ONLY. Nothing from a page message may
 *    trigger a privileged action directly; the background re-validates
 *    every payload, URL and tab before acting.
 *  - Messages from the content script carry the sender tab automatically
 *    (chrome.runtime.MessageSender.tab); the background never trusts a
 *    tabId field inside the payload.
 */

import type {
  ConversionJob,
  DetectionProvenance,
  ExportFormat,
  NormalizedModel,
  ProviderId,
} from '@/core/models/types';

/** main-world bridge → isolated content script (window CustomEvent). */
export type BridgeEvent = {
  bridge: 'modelport';
  version: 1;
  kind: 'response';
  /** Response URL after redirects (query redacted upstream of logging only). */
  url: string;
  /** Cap-sized JSON text of the response body. */
  bodyText?: string;
};

/** isolated content script → background service worker. */
export type ContentToBackgroundMessage =
  | {
      type: 'MODEL_PAYLOAD_DETECTED';
      providerId: ProviderId;
      /** Raw (untrusted) provider JSON payload. */
      payload: unknown;
      provenance: {
        source: DetectionProvenance;
        url: string;
      };
    }
  | {
      type: 'CONTENT_READY';
      providerId: ProviderId;
    };

/** background → content script (tabs.sendMessage). */
export type BackgroundToContentMessage = { type: 'SCAN_PAGE' };

/** Side Panel → background (request/response via sendMessage). */
export type PanelRequest =
  | { type: 'GET_TAB_STATE'; tabId?: number }
  | { type: 'DOWNLOAD_URL'; url: string; filename: string }
  | { type: 'ENSURE_HOST_PERMISSION'; origin: string }
  | { type: 'CHECK_HOST_PERMISSION'; origin: string }
  | { type: 'OPEN_SIDE_PANEL' };

export type PanelRequestResponse =
  | {
      type: 'TAB_STATE';
      tabId: number;
      supported: boolean;
      pluginEnabled?: boolean;
      providerId?: ProviderId;
      models: NormalizedModel[];
      /** True when the content-script observer is active. */
      observing: boolean;
      url?: string;
    }
  | { type: 'DOWNLOAD_STARTED'; downloadId: number }
  | { type: 'DOWNLOAD_REJECTED'; message: string }
  | { type: 'PERMISSION_STATE'; granted: boolean }
  | { type: 'ERROR'; code: string; message: string };

/** background → Side Panel (push, over a long-lived Port). */
export type PanelPushMessage =
  | { type: 'TAB_MODELS_UPDATED'; tabId: number; providerId?: ProviderId; pluginEnabled?: boolean; models: NormalizedModel[]; observing: boolean }
  | { type: 'ACTIVE_TAB_CHANGED'; tabId: number; url?: string };

/** Side Panel ⇄ conversion worker (same-page, transferable-friendly). */
export type WorkerRequest =
  | {
      type: 'CONVERT';
      jobId: string;
      source: { name: string; bytes: ArrayBuffer };
      format: ExportFormat;
      includeTextures: boolean;
      textures: { name: string; bytes: ArrayBuffer; mimeType: string }[];
      basename: string;
    }
  | { type: 'CANCEL'; jobId: string };

export type WorkerResponse =
  | {
      type: 'STAGE';
      jobId: string;
      stage: ConversionJob['stage'];
      detail?: string;
      progress?: number;
    }
  | {
      type: 'DONE';
      jobId: string;
      format: string;
      filename: string;
      data: ArrayBuffer;
      mimeType: string;
      packaged: boolean;
      files: { path: string; mimeType: string; byteLength: number }[];
      warnings: string[];
      stats: {
        meshCount: number;
        triangles: number;
        vertices: number;
        hasNormals: boolean;
        hasUvs: boolean;
        hasTextures: boolean;
        materials: number;
      };
    }
  | { type: 'FAILED'; jobId: string; code: string; message: string; detail?: string };

/** Type guard used by every runtime.onMessage handler. */
export function hasMessageType<T extends { type: string }>(
  msg: unknown,
  ...types: T['type'][]
): msg is T {
  if (typeof msg !== 'object' || msg === null) return false;
  const t = (msg as { type?: unknown }).type;
  return typeof t === 'string' && (types as string[]).includes(t);
}
