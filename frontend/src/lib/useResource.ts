import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

type Result<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: ApiError };

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, revision = 0, keepPrevious = false, enabled = true) {
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(count => count + 1), []);
  const [settled, setSettled] = useState<{
    load: typeof load;
    revision: number;
    retryCount: number;
    result: Result<T>;
  }>();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const settle = (result: Result<T>) => {
      if (!controller.signal.aborted) setSettled({ load, revision, retryCount, result });
    };
    load(controller.signal).then(
      data => settle({ state: 'ready', data }),
      (error: unknown) => settle({
        state: 'error',
        error: error instanceof ApiError ? error : new ApiError('invalid-response'),
      }),
    );
    return () => controller.abort();
  }, [load, revision, retryCount, enabled]);

  const current = settled?.load === load && settled.revision === revision && settled.retryCount === retryCount;
  const refreshing = !current;
  const result: Result<T> = enabled && (current || (keepPrevious && settled?.load === load && settled.result.state === 'ready'))
    ? settled.result : { state: 'loading' };
  const resolvedRevision = settled?.load === load ? settled.revision : undefined;
  return { result, retry, refreshing, resolvedRevision };
}
