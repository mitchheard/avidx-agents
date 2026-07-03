import { logger } from './logger';

type RetryOptions = {
  retries?: number;
  agentName?: string;
};

// Node-level network failures bubble up from undici/fetch as TypeError with
// a `cause` whose `.code` is one of these. Listed explicitly so we never
// retry an unknown error shape by accident.
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const e = err as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
    cause?: unknown;
  };

  // HTTP status on the error itself (Linear's LinearError, Notion's
  // HTTPResponseError / APIResponseError both expose `.status: number`).
  if (typeof e.status === 'number') {
    if (e.status >= 500 && e.status < 600) return true;
    if (e.status >= 400 && e.status < 500) return false;
  }

  // Notion's RequestTimeoutError, plus generic AbortController timeouts.
  if (
    e.name === 'RequestTimeoutError' ||
    e.name === 'AbortError' ||
    e.name === 'TimeoutError'
  ) {
    return true;
  }

  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true;

  if (e.cause && typeof e.cause === 'object') {
    const c = e.cause as { code?: unknown; name?: unknown };
    if (typeof c.code === 'string' && NETWORK_ERROR_CODES.has(c.code)) return true;
    if (c.name === 'AbortError' || c.name === 'TimeoutError') return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const label = opts.agentName ?? 'retry';

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      const delayMs = 1000 * 2 ** attempt;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[${label}] retry ${attempt + 1}/${retries} in ${delayMs}ms:`,
        message,
      );
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
