import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiLocal } from '../../lib/api';
import { getMarketingCapability } from '../marketing/api';
import { useResource } from '../../lib/useResource';
import { AccountFields, accountProblem } from '../marketing/CompanyAccess';

interface CompanyEntry { id:string; name:string }
const path='/marketing/companies/registry';
export function CompanyRegistry({selected,onSelect}:{selected:string;onSelect:(id:string)=>void}) {
  const {result}=useResource(getMarketingCapability);
  const [companies,setCompanies]=useState<CompanyEntry[]>([]);
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  const [notice,setNotice]=useState('');
  const request=useRef<AbortController>(undefined);
  useEffect(()=>()=>request.current?.abort(),[]);
  if(result.state!=='ready'||!result.data.company_accounts) return null;
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(request.current) return;
    const element=event.currentTarget;
    const form=new FormData(element);
    const token=String(form.get('operator')??'');
    const create=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='create';
    const controller=new AbortController(); request.current=controller;
    setError('');setNotice('');setPending(true);
    try {
      if(create){
        const record=await apiLocal<CompanyEntry>(path,token,controller.signal,'POST',{
          claim_existing_pilot:form.has('claim'),name:form.get('companyName'),username:form.get('username'),password:form.get('password')});
        const password=element.elements.namedItem('password') as HTMLInputElement;
        password.value='';
        setCompanies(prev=>[...prev,record]);onSelect(record.id);
        setNotice(record.name+' is ready. Give the administrator their sign-in details privately.');
      } else {
        setCompanies(await apiLocal<CompanyEntry[]>(path,token,controller.signal));
        setNotice('Company directory loaded.');
      }
    } catch(cause) { if(!controller.signal.aborted) setError(accountProblem(cause)); }
    finally { if(!controller.signal.aborted){setPending(false);request.current=undefined;} }
  }
  return <section className="operator-research-result" aria-label="Company workspaces"><h2>Company workspaces</h2>
    <form onSubmit={submit} className="operator-dataset-form">
      <label>Workspace operator credential<input type="password" name="operator" minLength={24} required autoComplete="off" /></label>
      <div><button type="submit" value="list" formNoValidate disabled={pending}>Load companies</button></div>
      <details><summary>Create a company and administrator</summary>
        <label>Company name<input name="companyName" required maxLength={120}/></label><AccountFields newPassword/>
        <label><input type="checkbox" name="claim" />Assign the earlier shared pilot to this company. I verified its dataset grants cover these members. This ends shared customer access.</label>
        <button value="create" disabled={pending}>Create company</button>
      </details>
    </form>
    <label>Dataset destination<select value={selected} disabled={pending} onChange={e=>onSelect(e.target.value)}>
      <option value="">Existing pilot workspace</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {selected && <p>Partner imports and withdrawals below apply to {companies.find(c=>c.id===selected)?.name}.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
