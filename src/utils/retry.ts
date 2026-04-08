interface RetryOptions {
  retries: number;
  initialDelayMs: number;
  factor?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const factor = options.factor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  let delayMs = options.initialDelayMs;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const normalizedError = toError(error);
      if (attempt > options.retries) {
        throw normalizedError;
      }

      options.onRetry?.(attempt, normalizedError, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(maxDelayMs, Math.ceil(delayMs * factor));
    }
  }
}
