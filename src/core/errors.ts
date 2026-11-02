/**
 * Typed domain errors with stable machine codes and user-readable messages.
 * Raw stack traces and signed URLs never reach the UI through these.
 */

export type ModelErrorCode =
  | 'UNSUPPORTED_PROVIDER'
  | 'MODEL_NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'ASSET_URL_EXPIRED'
  | 'ASSET_DOWNLOAD_FAILED'
  | 'CORS_OR_PERMISSION_DENIED'
  | 'UNSUPPORTED_MESHY_VERSION'
  | 'MODEL_DECODE_FAILED'
  | 'TEXTURE_MISSING'
  | 'UV_DATA_MISSING'
  | 'EXPORT_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'FILE_TOO_LARGE'
  | 'CANCELLED'
  | 'UNKNOWN';

const USER_MESSAGES: Record<ModelErrorCode, string> = {
  UNSUPPORTED_PROVIDER: 'This website is not supported yet.',
  MODEL_NOT_FOUND: 'No model was found on this page.',
  INVALID_RESPONSE: 'The data does not look like a supported model response.',
  ASSET_URL_EXPIRED: 'The model link has expired. Refresh the provider page and try again.',
  ASSET_DOWNLOAD_FAILED: 'The file could not be downloaded. Check your connection and retry.',
  CORS_OR_PERMISSION_DENIED:
    'The browser blocked access to this file. Grant access to its site, or download the original and import it manually.',
  UNSUPPORTED_MESHY_VERSION:
    'This Meshy file version is not supported by the local converter yet.',
  MODEL_DECODE_FAILED: 'The file could not be decoded. It may be corrupt or in a newer format.',
  TEXTURE_MISSING: 'The model was converted, but no texture was available.',
  UV_DATA_MISSING:
    'The model has no UV coordinates, so the provided texture cannot be mapped reliably. Geometry was exported without textures.',
  EXPORT_FAILED: 'Conversion failed while writing the output file.',
  DOWNLOAD_FAILED: 'Saving the file failed.',
  FILE_TOO_LARGE: 'The file exceeds the size limit for local processing.',
  CANCELLED: 'The operation was cancelled.',
  UNKNOWN: 'Something went wrong.',
};

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  /** Safe for UI display. */
  readonly userMessage: string;
  /** Diagnostics with sensitive parts redacted; dev-only. */
  readonly detail?: string;
  /** For CORS/permission errors: the origin that needs explicit user consent. */
  readonly origin?: string;

  constructor(
    code: ModelErrorCode,
    options: { message?: string; detail?: string; cause?: unknown; origin?: string } = {},
  ) {
    super(options.message ?? USER_MESSAGES[code], { cause: options.cause });
    this.name = 'ModelError';
    this.code = code;
    this.userMessage = options.message ?? USER_MESSAGES[code];
    this.detail = options.detail;
    this.origin = options.origin;
  }

  toJSON() {
    return { code: this.code, message: this.userMessage, ...(this.origin ? { origin: this.origin } : {}) };
  }
}

export function isModelError(e: unknown): e is ModelError {
  return e instanceof ModelError;
}

/** Normalize any thrown value into a ModelError without leaking internals. */
export function toModelError(e: unknown, fallbackCode: ModelErrorCode = 'UNKNOWN'): ModelError {
  if (e instanceof ModelError) return e;
  if (e instanceof Error) {
    if (e.name === 'AbortError') return new ModelError('CANCELLED', { cause: e });
    return new ModelError(fallbackCode, { detail: redactUrls(e.message), cause: e });
  }
  return new ModelError(fallbackCode, { detail: redactUrls(String(e)) });
}

/** Strip query strings (which carry signed tokens) from URLs in logs. */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
    try {
      const u = new URL(url);
      u.search = '';
      u.hash = '';
      return u.href;
    } catch {
      return url;
    }
  });
}
