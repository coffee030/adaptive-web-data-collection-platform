import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

type Result<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: ApiError };

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, revision = 0, keepPrevious = false, enabled = true,
  retainOnError = false) {
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(count => count + 1), []);
  const [settled, setSettled] = useState<{
    load: typeof load;
    revision: number;
    retryCount: number;
    result: Result<T>;
    lastReady?: Extract<Result<T>, { state: 'ready' }>;
    lastReadyRevision?: number;
  }>();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const settle = (result: Result<T>) => {
      if (!controller.signal.aborted) setSettled(previous => ({
        load, revision, retryCount, result,
        lastReady: result.state === 'ready' ? result : previous?.load === load ? previous.lastReady : undefined,
        lastReadyRevision: result.state === 'ready' ? revision : previous?.load === load ? previous.lastReadyRevision : undefined,
      }));
    };
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      load(controller.signal).then(
        data => settle({ state: 'ready', data }),
        (error: unknown) => settle({
          state: 'error',
          error: error instanceof ApiError ? error : new ApiError('invalid-response'),
        }),
      );
    });
    return () => controller.abort();
  }, [load, revision, retryCount, enabled]);

  const current = settled?.load === load && settled.revision === revision && settled.retryCount === retryCount;
  const refreshing = !current;
  const visible: Result<T> = enabled && (current || (keepPrevious && settled?.load === load && settled.result.state === 'ready'))
    ? settled.result : { state: 'loading' };
  const retained = enabled && retainOnError && settled?.load === load && settled.result.state === 'error' && settled.lastReady;
  const result: Result<T> = retained || visible;
  const refreshError = retained && settled.result.state === 'error' ? settled.result.error : undefined;
  const resolvedRevision = settled?.load === load ? (retained ? settled.lastReadyRevision : settled.revision) : undefined;
  return { result, retry, refreshing, resolvedRevision, refreshError };
}
