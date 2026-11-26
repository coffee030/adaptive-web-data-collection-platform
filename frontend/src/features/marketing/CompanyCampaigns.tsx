import { useCallback, useEffect, useState, type ReactNode, type SetStateAction } from 'react';
import { ApiError, apiGet, apiPut } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { blankBrief } from './contracts';
import { type Company } from './CompanyAccess';
import { DraftContext, type Draft, useDraftActions } from './workspace';

interface Saved { id:string; version:number; draft:Draft }
interface Entry extends Saved { acknowledged:Draft }
const url = '/marketing/companies/campaigns';
const fetchCampaigns = (signal:AbortSignal) => apiGet<Saved[]>(url,signal);

function empty():Entry {
  const draft:Draft = { brief:{...blankBrief}, saved:false, shortlist:[], explorer:'', lines:[] };
  return { id:crypto.randomUUID(), version:0, draft, acknowledged:draft };
}

function Editor({saved,company,children,reload}:{saved:Saved[];company:Company;children:ReactNode;reload:()=>void}) {
  const [entries,setEntries] = useState<Entry[]>(()=> saved.length ? saved.map(row=>({...row,acknowledged:row.draft})) : [empty()]);
  const pointer = 'harbourline-current/'+company.id+'/'+company.username;
  const [active,setActive] = useState(()=>{
    try { const id=sessionStorage.getItem(pointer); if(entries.some(row=>row.id===id)) return id!; } catch {}
    return entries[0]!.id;
  });
  const [saving,setSaving] = useState(false);
  const [failure,setFailure] = useState('');
  const [conflict,setConflict] = useState(false);
  const [retry,setRetry] = useState(0);
  const [generation] = useState(()=>({alive:true}));
  useEffect(()=>{ generation.alive=true; return ()=>{generation.alive=false;}; },[generation]);

  const entry=entries.find(row=>row.id===active)!;
  const dirty=entries.find(row=>row.draft!==row.acknowledged && (row.version>0 || row.draft.saved || row.draft.shortlist.length>0 || Boolean(row.draft.research)));
  useEffect(()=>{
    if(!dirty || saving || failure) return;
    setSaving(true);
    const controller=new AbortController();
    apiPut<Saved>(url+'/'+dirty.id,{version:dirty.version,draft:dirty.draft},controller.signal).then(savedRow=>{
      if(generation.alive) setEntries(previous=>previous.map(row=>row.id===savedRow.id ? {...row,version:savedRow.version,acknowledged:dirty.draft} : row));
    }).catch(cause=>{
      if (!generation.alive) return;
      const changed=cause instanceof ApiError && cause.status===409;
      setConflict(changed);
      setFailure(changed ? 'Another editor changed this campaign. Reload the company copy to continue.' : 'Campaign changes have not reached your company workspace.');
    }).finally(()=>{ if(generation.alive) setSaving(false); });
  },[dirty,saving,failure,retry,generation]);
  useEffect(()=>{
    if (!dirty && !saving) return;
    function protect(event:BeforeUnloadEvent) { event.preventDefault(); event.returnValue=''; }
    window.addEventListener('beforeunload',protect);
    return ()=>window.removeEventListener('beforeunload',protect);
  },[dirty,saving]);

  const setDraft=useCallback((action:SetStateAction<Draft>)=>{
    setEntries(previous=>{
      const current=previous.find(row=>row.id===active);
      if(!current) return previous;
      const next=typeof action==='function' ? action(current.draft) : action;
      return next===current.draft ? previous : previous.map(row=>row===current ? {...row,draft:next} : row);
    });
  },[active]);
  function openDraft(id?:string) {
    const next=id ? entries.find(row=>row.id===id) : empty();
    if(!next) return;
    if(!id) setEntries(previous=>[next,...previous]);
    setActive(next.id);
    try { sessionStorage.setItem(pointer,next.id); } catch {}
  }
  const actions=useDraftActions('partner',entry.draft,setDraft,false);
  return <DraftContext.Provider value={{...actions,company,campaignReceipt:{id:entry.id,version:entry.version,pending:entry.draft!==entry.acknowledged},openDraft,otherDrafts:()=>entries.filter(row=>row.id!==active && (row.draft.saved||row.draft.shortlist.length>0||Boolean(row.draft.research))).map(row=>({key:row.id,name:row.draft.brief.name||row.draft.research?.title||'Untitled campaign'}))}}>
    {failure && <p role="alert" className="hl-storage">{failure} <button onClick={()=>{if(conflict) reload(); else {setFailure('');setRetry(i=>i+1);}}}>{conflict?'Reload saved campaign':'Retry save'}</button></p>}
    {saving && <div className="hl-company-saving" role="status">Saving company campaign…</div>}{children}
  </DraftContext.Provider>;
}

export function CompanyCampaigns({company,children}:{company:Company;children:ReactNode}) {
  const {result,retry}=useResource(fetchCampaigns);
  if(result.state==='loading') return <main className="harbour hl-page" role="status">Loading company campaigns…</main>;
  if(result.state==='error') return <main className="harbour hl-page"><p role="alert">Company campaigns could not be opened.</p><button onClick={retry}>Retry</button></main>;
  return <Editor saved={result.data} reload={retry} company={company}>{children}</Editor>;
}
