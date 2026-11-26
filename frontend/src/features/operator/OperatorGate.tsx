import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError, apiLocal, getOperatorCredential, setOperatorCredential } from '../../lib/api';
import '../../components/studio/tabler.css';
import '../../components/studio/workspace.css';
import './frame.css';

export function OperatorGate({ children }: { children: ReactNode }) {
  const [active,setActive] = useState(Boolean(getOperatorCredential()));
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    function lock() {
      request.current?.abort();
      request.current = null;
      setActive(false); setPending(false);
      setError('Operator access ended. Use the workstation key to reopen this page.');
    }
    window.addEventListener('harbourline-operator-locked',lock);
    return () => {
      window.removeEventListener('harbourline-operator-locked',lock);
      request.current?.abort(); setOperatorCredential('');
    };
  },[]);
  useEffect(() => { if (!active) document.title = 'Operator access | Harbourline'; },[active]);

  const workstation = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  async function unlock(input: File | string) {
    if (!workstation || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError('');
    try {
      if (typeof input !== 'string' && (input.size < 24 || input.size > 1024)) {
        setError('Choose the operator key file named by the launcher.'); return;
      }
      const key = (typeof input === 'string' ? input : await input.text()).trim();
      if (controller.signal.aborted) return;
      if (typeof input !== 'string' && !/^[A-Za-z0-9._~+/=-]{24,512}$/.test(key)) {
        setError('This file does not contain a single operator key. Choose the key file named by the launcher.'); return;
      }
      await apiLocal('/marketing/companies/registry',key,controller.signal);
      if (controller.signal.aborted) return;
      setOperatorCredential(key); setActive(true);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
        ? 'Access denied. Choose the operator key for this workstation.'
        : cause instanceof ApiError && cause.kind === 'timeout' ? 'The workstation took too long to respond. Try unlocking again.'
        : cause instanceof ApiError ? 'Could not reach Harbourline. Open its launcher and check the workstation is running.'
        : 'The key file could not be read. Select it again or enter the key manually.');
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  if (active) return <>{children}</>;
  return <main className="studio ops-access" data-workspace="operations">
    <div className="ops-access-layout">
      <Link className="ops-access-brand" to="/">Harbourline</Link>
      <section className="studio-panel ops-access-panel" aria-labelledby="ops-access-title">
        <div className="studio-panel-body">
          <p className="ops-access-workspace">Scraping Operations</p>
          <h1 id="ops-access-title">{workstation ? 'Operator access required' : 'Open the local workstation'}</h1>
          {workstation ? <>
            <p>Use the operator key from the Harbourline launcher to manage sources, collections and publication on this workstation.</p>
            <label className="ops-key-file"><span>Choose operator key file</span>
              <input type="file" accept=".token,.key,.txt,text/plain" disabled={pending} onChange={event => {
                const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
                if (file) void unlock(file);
              }}/>
            </label>
            <p className="ops-file-hint">The launcher shows the location of <code>harbourline-operator.token</code>. Access lasts in this tab until you lock it, leave Operations or reload.</p>
            <form className="ops-key-form" onSubmit={event => {
              event.preventDefault(); const form = event.currentTarget;
              const key = String(new FormData(form).get('credential') ?? ''); form.reset(); void unlock(key);
            }}>
              <label htmlFor="operator-credential">Workstation operator credential</label>
              <div><input id="operator-credential" type="password" name="credential" minLength={24} maxLength={512} autoComplete="off" required disabled={pending}/>
                <button className="studio-secondary" disabled={pending} type="submit">Unlock Data Operations</button></div>
            </form>
            {pending && <p role="status">Checking workstation access…</p>}
            {error && <p className="ops-access-error" role="alert">{error}</p>}
          </> : <p>Open the local address shown in the Harbourline launcher to use the workstation operator key.</p>}
        </div>
      </section>
      <p className="ops-access-return"><Link to="/">Return to Harbourline</Link> for company research and campaigns.</p>
    </div>
  </main>;
}
