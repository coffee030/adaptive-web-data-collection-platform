import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useResource } from '../../lib/useResource';
import { ApiError, apiGet, apiPost, setCompanyScope } from '../../lib/api';
import { Brand, Overlay } from './components';
import './company.css';
import './business.css';
import { useMarketing } from './workspace';

export interface Company {
  id: string;
  name: string;
  username: string;
  role: 'member' | 'admin';
}

const base = '/marketing/companies';
const registration = (signal: AbortSignal) => apiGet<{enabled:boolean;first_company?:boolean}>(base+'/register',signal);
function broadcastSession() {
  const updates = new BroadcastChannel('harbourline-signin');
  updates.postMessage('changed'); updates.close();
}
export function accountProblem(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many sign-in attempts. Try again in five minutes.';
    if (error.status === 401) return 'Check your account name and password.';
    if (error.status === 403) return 'This action requires administrator or operator access.';
    if (error.status === 409) return 'The account or company name is already in use, or the workspace has changed.';
    if (error.status === 422) return 'Check the account name and password length.';
  }
  return 'Could not reach the company workspace. Try again.';
}

export function AccountFields({ newPassword = false }: { newPassword?: boolean }) {
  return <><label>Account name<input name="username" required minLength={3} maxLength={80} pattern="[a-z0-9][a-z0-9._@+\-]{2,79}"
    autoComplete={newPassword ? 'off' : 'username'} autoCapitalize="none" spellCheck={false} /></label>
    <label>{newPassword ? 'New password' : 'Password'}<input name="password" type="password" minLength={12} maxLength={256}
      required autoComplete={newPassword ? 'new-password' : 'current-password'} /></label></>;
}

export function CompanyGate({ children }: { children: (company: Company) => ReactNode }) {
  const [account, setAccount] = useState<Company | null>();
  const [createChoice, setCreating] = useState<boolean|null>(null);
  const {pathname} = useLocation();
  const setup = useResource(registration, 0, false, account === null);
  const creating = createChoice ?? (setup.result.state === 'ready' && setup.result.data.first_company === true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const signedIn = useRef(false);
  const sessionCheck = useRef(0);
  const [expired,setExpired] = useState(false);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    async function check() {
      const sequence = ++sessionCheck.current;
      try {
        const user = await apiGet<Company>(base+'/session',controller.signal);
        if (current && sequence === sessionCheck.current) { signedIn.current = true; setExpired(false); setCompanyScope(user.id); setAccount(user); setError(''); }
      } catch (cause) {
        if (!current || sequence !== sessionCheck.current) return;
        setCompanyScope(undefined);
        if (cause instanceof ApiError && cause.status === 401) { if (signedIn.current) setExpired(true); signedIn.current=false; setAccount(null); setError(''); }
        else { setAccount(undefined); setError(accountProblem(cause)); }
      }
    }
    void check();
    const updates = new BroadcastChannel('harbourline-signin');
    updates.onmessage=check;
    const timer = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    window.addEventListener('company-session', check);
    return () => { current = false; updates.close(); controller.abort(); window.clearInterval(timer); window.removeEventListener('focus',check); window.removeEventListener('company-session',check); setCompanyScope(undefined); };
  }, [attempt]);

  useEffect(() => { if (!account) document.title = 'Company access | Harbourline'; }, [account]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      const user = await apiPost<Company>(base+(creating ? '/register' : '/session'),Object.fromEntries(form),new AbortController().signal);
      ++sessionCheck.current; signedIn.current = true; setExpired(false);
      setCompanyScope(user.id); setAccount(user);
      broadcastSession();
    } catch (cause) { setError(accountProblem(cause)); } finally { setPending(false); }
  }
  if (account) return <>{children(account)}</>;
  const destination: Record<string,string> = {creators:'creator discovery',research:'Campaign Advisor',campaigns:'your campaigns',reports:'campaign reports',plan:'the campaign plan'};
  const pageName = destination[pathname.split('/')[1] ?? ''];
  const canRegister = setup.result.state === 'ready' && setup.result.data.enabled;
  return <main className="business-entry studio" data-workspace="marketing">
    <header className="entry-mast"><Brand/><Link to="/operations">Scraping Operations ↗</Link></header>
    <div className="entry-layout"><section className="entry-purpose">
      <h1>Marketing <br/>intelligence<span>.</span></h1>
      <p>Find creators covering Hong Kong, inspect their published work and plan campaigns with your team.</p>
      <div className="entry-workflow"><span>Creator discovery</span><span>Campaign Advisor</span><span>Performance reports</span></div>
    </section><section className="entry-form">
      <h2>{creating ? 'Create a company workspace' : 'Open your workspace'}</h2>
      <p>{creating ? 'You’ll be the first administrator. Invite your team after you sign in.' : pageName ? 'Sign in to continue to '+pageName+'.' : 'Sign in with your company account.'}</p>
      {expired && <p role="status">Your session ended. Sign in to return to your work.</p>}
      {canRegister && (
        <button className="entry-switch" disabled={pending} onClick={() => {
          setCreating(!creating);
          setError('');
        }}>
          {creating ? 'Use an existing account' : 'Create a new company workspace'} <span aria-hidden="true">→</span>
        </button>
      )}
      {account === null ? <form className="hl-form-grid" key={creating ? 'create' : 'login'} onSubmit={login}>
        {creating && <label>Company name<input name="name" required maxLength={120} autoComplete="organization"/></label>}
        <AccountFields newPassword={creating}/>{creating && <small>Use a lowercase account name and a password of at least 12 characters.</small>}
        <button className="studio-primary" disabled={pending}>{pending ? 'Opening workspace…' : creating ? 'Create workspace' : 'Sign in'}</button>
      </form> : !error && <p role="status">Opening your company workspace…</p>}
      {error && <p role="alert">{error} {account === undefined && <button onClick={()=>setAttempt(value=>value+1)}>Retry</button>}</p>}
      {setup.result.state === 'error' && <button className="entry-switch" onClick={setup.retry}>Check workspace registration</button>}
      {account === null && !creating && <details className="entry-help"><summary>Joining an existing company?</summary><p>Ask a company administrator to add your account from the company menu.</p></details>}
    </section></div></main>;
}

export function CompanyControls() {
  const { company } = useMarketing();
  const [open,setOpen] = useState(false);
  const [members,setMembers] = useState<Pick<Company,'username'|'role'>[]>([]);
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  const [version,setVersion] = useState(0);
  useEffect(()=>{
    if (!open || company?.role !== 'admin') return;
    const controller = new AbortController();
    apiGet<Pick<Company,'username'|'role'>[]>(base+'/members',controller.signal).then(setMembers).catch(cause=>{ if (!controller.signal.aborted) setError(accountProblem(cause)); });
    return ()=>controller.abort();
  }, [company?.id,company?.role,open,version]);
  if (!company) return null;
  async function remove(username?:string) {
    if (username && !window.confirm('Remove access for '+username+'?')) return;
    setError(''); setPending(true);
    try {
      const response = await fetch('/api/v1'+base+(username ? '/members/'+encodeURIComponent(username) : '/session'),{method:'DELETE',headers:{'X-Harbourline-Company':company!.id}});
      if (!response.ok) throw new ApiError('http',response.status);
      if (username) setVersion(n=>n+1);
      else { broadcastSession(); setCompanyScope(undefined); window.dispatchEvent(new Event('company-session')); }
    } catch(cause) { setError(accountProblem(cause)); } finally {setPending(false);}
  }
  async function add(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element=event.currentTarget, form=new FormData(element);
    setError(''); setPending(true);
    try {
      await apiPost(base+'/members',Object.fromEntries(form),new AbortController().signal);
      element.reset(); setVersion(n=>n+1);
    } catch(cause) { setError(accountProblem(cause)); } finally {setPending(false);}
  }
  return <div className="hl-company-menu">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{company.name}</button>
{open && <Overlay title={company.name} close={()=>setOpen(false)}><p>{company.username} · {company.role === 'admin' ? 'Administrator' : 'Member'}</p>
      {company.role === 'admin' && <><h3>Team members</h3><ul className="hl-members">{members.map(person=><li key={person.username}>
        <span>{person.username} · {person.role}</span> {person.username !== company.username && <button disabled={pending} aria-label={'Remove '+person.username} onClick={()=>remove(person.username)}>Remove</button>}</li>)}</ul>
        <h3>Add a team member</h3><form className="hl-form-grid" onSubmit={add}><AccountFields newPassword /><label>Access<select name="role"><option value="member">Member</option><option value="admin">Administrator</option></select></label>
        <div><button disabled={pending}>Add member</button></div></form></>}
      <button disabled={pending} onClick={()=>remove()}>Sign out</button>{error && <p role="alert">{error}</p>}
    </Overlay>}
  </div>;
}
