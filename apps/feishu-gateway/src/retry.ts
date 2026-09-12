export type RetryOptions = {
  attempts: number;
  delayMs: number;
};

export const DEFAULT_EVENT_RETRY: RetryOptions = { attempts: 5, delayMs: 200 };

export async function runWithRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && options.delayMs > 0) {
        const waitMs = options.delayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastError;
}
