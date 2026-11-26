import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMarketing, type ResearchBrief } from './workspace';

const empty: ResearchBrief = { title:'', objective:'', deliverable:'', budget:null, leads:[] };
const key = 'harbourline-public-research-v1';
function localBrief(): ResearchBrief {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (data && Array.isArray(data.leads) && typeof data.title === 'string') return {...empty,...data};
  } catch {}
  return empty;
}
type Update = (old:ResearchBrief)=>ResearchBrief;
const Research = createContext<{brief:ResearchBrief; update:(change:Update)=>void; toggle:(id:string,workIds?:string[])=>void} | null>(null);

export function ResearchProvider({children}:{children:ReactNode}) {
  const {mode,draft,setDraft}=useMarketing();
  const local = mode === 'server-demo';
  const [guest,setGuest] = useState(() => local ? localBrief() : empty);
  const [failed,setFailed] = useState(false);
  const brief = local ? guest : draft.research ?? empty;
  useEffect(() => {
    if (!local) return;
    function sync(event:StorageEvent) { if(event.key===key) setGuest(localBrief()); }
    window.addEventListener('storage',sync);
    return ()=>window.removeEventListener('storage',sync);
  },[local]);
  function update(change:Update) {
    if (local) {
      const next = change(failed ? guest : localBrief());
      setGuest(next);
      try { localStorage.setItem(key,JSON.stringify(next)); setFailed(false); } catch {setFailed(true);}
    } else setDraft(old=>({...old,research:change(old.research ?? empty)}));
  }
  function toggle(id:string,workIds?:string[]) {
    update(old=>{
      const works={...old.works};
      if(old.leads.includes(id)) { delete works[id]; return {...old,works,leads:old.leads.filter(lead=>lead!==id)}; }
      if(old.leads.length>=40) return old;
      if(workIds?.length) works[id]=[...new Set(workIds)].slice(0,128);
      return {...old,works,leads:[...old.leads,id]};
    });
  }
  return <Research.Provider value={{brief,update,toggle}}>
    {failed && <p role="alert">Browser storage is unavailable. Export your research before closing this tab.</p>}{children}
  </Research.Provider>;
}

export function useResearch() {
  const value=useContext(Research);
  if(!value) throw new Error('Research workspace is missing');
  return value;
}

export function SaveResearchLead({id,name,workIds}:{id:string;name:string;workIds?:string[]}) {
  const {brief,toggle}=useResearch();
  const saved=brief.leads.includes(id);
  const full = !saved && brief.leads.length >= 40;
  const label = saved ? 'Saved to shortlist' : full ? 'Shortlist full' : 'Save to shortlist';
  return <button type="button" className="hl-save-lead" aria-pressed={saved} aria-label={label+' · '+name}
    disabled={full} onClick={()=>toggle(id,workIds)}>{label}</button>;
}