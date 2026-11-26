import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError, apiLocal, getOperatorCredential, setOperatorCredential } from '../../lib/api';
import { Brand } from '../marketing/components';
import '../marketing/marketing.css';
import '../marketing/analytics.css';

export function OperatorGate({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(Boolean(getOperatorCredential()));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController>(undefined);
  useEffect(() => {
    function lock() {
      setActive(false);
      setError('Operator access ended. Enter the workstation credential to continue.');
    }
    window.addEventListener('harbourline-operator-locked', lock);
    return () => {
      window.removeEventListener('harbourline-operator-locked', lock);
      request.current?.abort();
      setOperatorCredential('');
    };
  }, []);

  useEffect(() => { if (!active) document.title = 'Operator access | Harbourline'; }, [active]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = event.currentTarget;
    const credential = String(new FormData(form).get('credential') ?? '').trim();
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError('');
    try {
      await apiLocal('/marketing/companies/registry', credential, controller.signal);
      if (controller.signal.aborted) return;
      form.reset();
      setOperatorCredential(credential);
      setActive(true);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
        ? 'Access denied. Use the credential file listed by the pilot launcher.'
        : cause instanceof ApiError && cause.kind === 'timeout' ? 'The API request timed out. Try unlocking again.'
        : 'Could not reach the pilot. Check that it is running and try again.');
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  if (active) return <>{children}</>;
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return <main><h1>Open the workstation pilot</h1><p>Use the local address printed by the pilot launcher for operator access.</p><Link to="/">Return to Harbourline</Link></main>;
  return <main className="harbour dark hl-company-access"><section className="hl-page hl-entry">
    <Brand/><h1>Operator access required</h1>
    <p>Data Operations is for the person who runs this workstation. Company administrators and members use the company pilot.</p>
    <form className="hl-form-grid" onSubmit={unlock}>
      <label>Workstation operator credential<input name="credential" type="password" minLength={24} maxLength={512} autoComplete="off" required/></label>
      <p className="hl-note">Find the credential file in the pilot launcher’s output. Access lasts until you lock this tab, reload it or leave Data Operations.</p>
      {error && <p role="alert">{error}</p>}
      <button className="hl-primary" disabled={pending}>{pending ? 'Checking access…' : 'Unlock Data Operations'}</button>
    </form>
    <Link to="/">Return to Harbourline</Link>
  </section></main>;
}
