// Shared application error utilities.

/**
 * Structured application error with status/code metadata.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message || "error");
    this.name = "AppError";
    this.status = Number.isFinite(options.status) ? options.status : 500;
    this.code = options.code || "APP_ERROR";
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Normalize unknown errors into a consistent shape.
 * @param {unknown} err
 * @param {{ status?: number, code?: string, message?: string }} [fallbacks]
 */
export function normalizeError(err, fallbacks = {}) {
  const fallbackStatus = Number.isFinite(fallbacks.status) ? fallbacks.status : 500;
  const fallbackCode = fallbacks.code || "error";
  const fallbackMessage = fallbacks.message || "error";

  if (err instanceof AppError) {
    return {
      status: Number.isFinite(err.status) ? err.status : fallbackStatus,
      code: err.code || fallbackCode,
      message: err.message || fallbackMessage,
      cause: err.cause
    };
  }

  if (err && typeof err === "object") {
    const anyErr = err;
    return {
      status: Number.isFinite(anyErr.status) ? anyErr.status : fallbackStatus,
      code: anyErr.code || fallbackCode,
      message: anyErr.message || fallbackMessage,
      cause: anyErr.cause
    };
  }

  if (typeof err === "string") {
    return { status: fallbackStatus, code: fallbackCode, message: err };
  }

  return { status: fallbackStatus, code: fallbackCode, message: fallbackMessage };
}
