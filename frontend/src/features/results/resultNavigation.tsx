import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, type LinkProps } from 'react-router';
import { maxOffset } from '../collection-jobs/api';

const uuid = /^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

export function resultId(value: string | null) {
  return value && uuid.test(value) ? value.toLowerCase() : '';
}

export function readId(search: URLSearchParams, key: string) {
  const values = search.getAll(key);
  return values.length === 1 ? resultId(values[0] ?? null) : '';
}

export function readOffset(search: URLSearchParams, key = 'offset') {
  const value = search.get(key);
  return value && /^\d+$/.test(value) && Number(value) <= maxOffset ? Number(value) : 0;
}

const resultPath = /^\/(?:records|articles|evidence|collection-jobs|collection-requests)(?:\/([^/]+))?$/;

function safeContext(value: unknown) {
  if (typeof value !== 'string' || value.length > 3500 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\x00-\x20]/.test(value)) return '';
  const path = value.split(/[?#]/, 1)[0] ?? '';
  const quarantine = /^\/collection-jobs\/([^/]+)\/quarantine$/.exec(path);
  if (quarantine && resultId(quarantine[1] ?? null)) return value;
  const match = resultPath.exec(path);
  return match && (!match[1] || resultId(match[1])) ? value : '';
}

export function withContext(path: string, context: string) {
  const safe = safeContext(context);
  if (!safe) return path;
  const [address, hash] = path.split('#');
  const [pathname, query] = (address ?? '').split('?');
  const params = new URLSearchParams(query);
  params.set('from', safe);
  return pathname + '?' + params + (hash ? '#' + hash : '');
}

export function contextFrom(search: string) {
  return safeContext(new URLSearchParams(search).get('from'));
}

interface ReturnPosition { id: string; top: number }
const positions = new Map<string, ReturnPosition>();

export function rememberPosition(key: string, id: string) {
  positions.delete(key);
  positions.set(key, { id, top: window.scrollY });
  if (positions.size > 64) positions.delete(positions.keys().next().value!);
}

export function useResultReturn(ready: boolean) {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    const position = navigationType === 'POP' ? positions.get(key) : undefined;
    if (!ready || !position) return;
    const { id, top } = position;
    let frame = 0;
    const observer = new MutationObserver(schedule);
    function schedule() {
      if (frame || !document.getElementById(id)) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const target = document.getElementById(position!.id);
        if (!target || !target.getClientRects().length) return;
        observer.disconnect();
        window.scrollTo({ top: position!.top, behavior: 'instant' });
        target.focus({ preventScroll: true });
        const rect = target.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) target.scrollIntoView({ block: 'nearest' });
      });
    }
    const workspace = document.getElementById('main-content');
    if (workspace) observer.observe(workspace, { childList: true, subtree: true });
    schedule();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [key, navigationType, ready]);
}

export function useReturnPosition() {
  const { key } = useLocation();
  return useNavigationType() === 'POP' && positions.has(key);
}

export function ContextLink({ to, id, onClick, ...props }: Omit<LinkProps, 'to' | 'state'> & {
  to: string; id: string;
}) {
  const { pathname, search, hash, key } = useLocation();
  const from = pathname + search + hash;
  return <Link {...props} id={id} to={withContext(to, from)} state={{ resultOrigin: from }}
    onClick={event => {
      onClick?.(event);
      if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        rememberPosition(key, id);
      }
    }} />;
}

export function ReturnLink({ to, ...props }: Omit<LinkProps, 'to'> & { to: string }) {
  const { state } = useLocation();
  const navigate = useNavigate();
  return <Link {...props} to={to} onClick={event => {
    if (!event.defaultPrevented && state?.resultOrigin === to
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void navigate(-1);
    }
  }} />;
}

export function returnLabel(path: string) {
  if (path.split('?')[0]?.endsWith('/quarantine')) return 'Back to Quarantine';
  if (path.startsWith('/collection-jobs/')) return 'Back to Job';
  if (path.startsWith('/articles/')) return 'Back to Article History';
  if (path.startsWith('/articles')) return 'Back to Articles';
  if (path.startsWith('/collection-requests/')) return 'Back to Collection Request';
  if (path.startsWith('/records/')) return 'Back to Record Details';
  if (new URLSearchParams(path.split('?')[1]).has('record_id')) return 'Back to Record Inspector';
  return 'Back to Records';
}
