import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loading, Pagination, RequestProblem } from '../../components/feedback';
import { ApiError } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { listPage } from './api';

const messages: Record<string, string> = {
  duplicate_catalog_name: 'This name is already in use.',
  duplicate_binding: 'That source and profile version are already bound to this topic.',
  binding_requires_search: 'Choose an approved keyword-search profile.',
  binding_ineligible: 'A selected binding is unavailable. Check the topic’s current bindings.',
  topic_inactive: 'Activate the topic and its category before collecting.',
  source_not_approved: 'A selected source is no longer authorized.',
  profile_not_approved: 'A selected profile version is no longer approved.',
  collection_request_conflict: 'The submission key belongs to another collection.',
  destination_denied: 'A pinned search destination is outside the current source policy.',
  invalid_request: 'Check the fields and try again.',
};

export function useAction() {
  const current = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => () => current.current?.abort(), []);

  async function run<T>(action: (signal: AbortSignal) => Promise<T>, done: (value: T) => void, confirmation = '') {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action(controller.signal);
      if (!controller.signal.aborted) {
        setNotice(confirmation);
        done(result);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const code = error instanceof ApiError ? error.code : undefined;
        setError((code && messages[code]) || 'The action could not be confirmed. Check the connection and try again.');
      }
    } finally {
      current.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return { run, busy, error, notice };
}

export function ActionFeedback({ action, pending = 'Saving…' }: {
  action: ReturnType<typeof useAction>; pending?: string;
}) {
  return <>
    {action.busy && <p role="status">{pending}</p>}
    {action.error && <p className="form-problem" role="alert">{action.error}</p>}
    {action.notice && <p className="source-confirmation" role="status">{action.notice}</p>}
  </>;
}

export function Resource<T>({ state, label, children }: {
  state: ReturnType<typeof useResource<T>>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  const { result, retry } = state;
  if (result.state === 'loading') return <Loading>Loading {label}…</Loading>;
  if (result.state === 'error') return <RequestProblem error={result.error} resource={label} retry={retry} />;
  return <>{children(result.data)}</>;
}

export function Page<T>({ path, label, empty, requestId, revision, children }: {
  path: string; label: string; empty: string; requestId?: string; revision?: number;
  children: (rows: T[]) => ReactNode;
}) {
  const size = 20;
  const [offset, setOffset] = useState(0);
  const load = useCallback((signal: AbortSignal) => listPage<T>(
    path, signal, size + 1, offset, requestId ? { request_id: requestId } : {},
  ), [path, offset, requestId]);
  const state = useResource(load, revision, true);
  return <Resource label={label.toLowerCase()} state={state}>{rows => <>
    {rows.length ? children(rows.slice(0, size)) : <p className="notice muted">{empty}</p>}
    {(offset > 0 || rows.length > size) && <Pagination label={label} offset={offset} size={size}
      loaded={rows.length} change={setOffset} />}
  </>}</Resource>;
}
