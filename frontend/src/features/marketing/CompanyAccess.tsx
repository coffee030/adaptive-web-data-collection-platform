import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { WorkspaceDestination } from './WorkspaceDestination';
import { ApiError, apiGet, apiPost, setCompanyScope } from '../../lib/api';
import { Brand, Overlay } from './components';
import './company.css';
import { useMarketing } from './workspace';

export interface Company {
  id: string;
  name: string;
  username: string;
  role: 'member' | 'admin';
}

const base = '/marketing/companies';
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

  useEffect(() => { if (!account) document.title = 'Company pilot | Harbourline'; }, [account]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try {
      const user = await apiPost<Company>(base+'/session',{username:form.get('username'),password:form.get('password')},new AbortController().signal);
      ++sessionCheck.current; signedIn.current = true; setExpired(false);
      setCompanyScope(user.id); setAccount(user);
      broadcastSession();
    } catch (cause) { setError(accountProblem(cause)); } finally { setPending(false); }
  }
  if (account) return <>{children(account)}</>;
  return <main className="harbour dark hl-company-access hl-pilot-entry"><section className="hl-page hl-entry"><div className="hl-entry-intro"><Brand/><h1>Company pilot</h1>
    <p>Research Hong Kong creators and plan campaigns with your team.</p>
    {(account === null || error) && <WorkspaceDestination destination="demo"/>}</div>
    <div className="hl-signin-column"><h2>Company sign in</h2><p>Use the account provided by your company administrator.</p>
    {expired && <p role="status">Your company session ended. Sign in again to reopen your saved campaigns.</p>}
    {account === null ? <form className="hl-form-grid" onSubmit={login}><AccountFields />
      <div><button className="hl-primary" disabled={pending}>Sign in</button></div></form> : !error && <p role="status">Opening your company workspace…</p>}
    {error && <p role="alert">{error} {account === undefined && <button onClick={()=>setAttempt(value=>value+1)}>Retry</button>}</p>}
    {(account === null || error) && <>
      <details className="hl-account-help"><summary>How do I get an account?</summary>
        <p>Ask your company administrator to open the company menu, choose Add a team member and send you your account details privately. For a new company, ask the person running this workstation to create the first administrator.</p>
      </details>
      <p className="hl-entry-operator"><Link to="/operations/companies">Operator setup</Link> · Create a company or its first administrator.</p>
    </>}
  </div></section></main>;
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
