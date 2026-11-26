import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { amount, date, deliverableOptions, languageOptions, platformOptions, type CampaignRequest } from './intelligence';
import { ResearchFindings, type BusinessBrief, type ResearchReport } from './ResearchFindings';
import { useMarketing } from './workspace';
import './research-campaign.css';

type State = 'queued'|'collecting'|'analyzing'|'ready'|'failed'|'cancelled';
interface Run {
  id: string; state: State; campaign_id: string | null; brief: BusinessBrief;
  created_at: string; updated_at: string; error: string | null;
  sources: { key:string; name:string; state:string; pending:boolean; error:string|null }[];
}
const route='/marketing/companies/research-runs';
const loadHistory=(signal:AbortSignal)=>apiGet<Run[]>(route+'?limit=12',signal);
const phases:Record<State,string>={queued:'Queued',collecting:'Checking sources',analyzing:'Comparing evidence',ready:'Findings ready',failed:'Research interrupted',cancelled:'Cancelled'};
const active=(state:State)=>state==='queued'||state==='collecting'||state==='analyzing';
const example={question:'Find Hong Kong creators who cover affordable dining and compare funded options for a neighbourhood café launch.', product:'Neighbourhood café lunch offer', audience:'Hong Kong residents looking for affordable weekday lunches',focus:'affordable dining'};

function failure(error:unknown) {
  if (!(error instanceof ApiError)) return 'Research could not be opened. Try again.';
  if(error.code==='research_evidence_changed' || error.code==='catalog_changed') return 'The source evidence changed. Refresh the research to review current findings.';
  if(error.code==='research_capacity') return 'Four company research runs are active. Finish or cancel one to start another.';
  if(error.status===404) return 'This research is unavailable to your company. Open a recent brief or start your own.';
  if(error.status===401) return 'Sign in to your company to reopen this research.';
  if(error.kind==='timeout') return 'The workspace took too long to respond. Your research can continue in the background.';
  return 'The current research could not be loaded. Try again.';
}

function RunDetail({id,onRefresh,onAdjust}:{id:string;onRefresh:()=>void;onAdjust:(brief:BusinessBrief)=>void}) {
  const {path, setDraft, campaignReceipt, openDraft}=useMarketing();
  const navigate=useNavigate();
  const [chosen,setChosen]=useState<CampaignRequest|null>(null);
  const load=useCallback((s:AbortSignal)=>apiGet<Run>(route+'/'+encodeURIComponent(id),s),[id]);
  const {result,retry}=useResource(load,0,true);
  const run=result.state==='ready'?result.data:undefined;
  useEffect(()=>{
    if(!chosen || !run || (run.campaign_id && run.campaign_id!==campaignReceipt?.id)) return;
    setDraft(old=>({...old, saved:true, brief:{...old.brief,name:old.brief.name||run.brief.product,description:chosen.description,budget:chosen.budget_minor/100,platform:chosen.platform,deliverable:chosen.deliverable,objective:chosen.objective},evaluation:chosen}));
    setChosen(null);navigate(path('plan'));
  },[chosen,run,campaignReceipt?.id,setDraft,navigate,path]);
  const reportLoad=useCallback((s:AbortSignal)=>apiGet<ResearchReport>(route+'/'+encodeURIComponent(id)+'/results',s,60000),[id]);
  const {result:report,retry:readReport}=useResource(reportLoad,run?Date.parse(run.updated_at):0,false,run?.state==='ready');
  const [action,setAction]=useState('');
  const [error,setError]=useState('');
  const live=useRef<AbortController|null>(null);
  useEffect(()=>{if(run) onRefresh();},[run?.state,onRefresh]);
  useEffect(()=>()=>live.current?.abort(),[]);
  useEffect(()=>{
    if(!run || !active(run.state)) return;
    const timer=window.setTimeout(retry,2200);
    return ()=>window.clearTimeout(timer);
  },[run,retry]);
  useEffect(()=>{
    if(run?.state!=='ready') return;
    const visible=()=>{ if(document.visibilityState==='visible') readReport(); };
    const timer=window.setInterval(visible,60000);
    window.addEventListener('focus',visible);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',visible);};
  },[run?.state,readReport]);
  async function command(name:'resume'|'cancel'){
    const controller=new AbortController();
    live.current=controller;
    setAction(name);setError('');
    try { await apiPost(route+'/'+id+'/'+name,{},controller.signal);retry();onRefresh(); }
    catch(cause){if(!controller.signal.aborted)setError(failure(cause));}
    finally{if(!controller.signal.aborted)setAction('');}
  }
  if(result.state==='error') return <section className="rc-message"><p role="alert">{failure(result.error)}</p><button className="studio-secondary" onClick={retry}>Retry</button></section>;
  if(!run) return <p className="rc-message" role="status">Opening your research…</p>;
  return <div className="rc-result">
    <header className="rc-brief-head"><div className="rc-caption">Company research · {date(run.created_at)}</div><h2>{run.brief.product}</h2><p>{run.brief.campaign.description}</p>
      <div className="rc-basics">{amount(run.brief.campaign.budget_minor,run.brief.campaign.currency)} budget <span>·</span> {platformOptions[run.brief.campaign.platform]} <span>·</span> {run.brief.campaign.objective === 'awareness' ? 'Awareness' : 'Engagement'}</div>
    </header>
    {run.state==='ready' ? <>
      {report.state==='ready' ? <ResearchFindings key={run.updated_at} report={report.data} onUse={(platform,budget_minor)=>{
        if(run.campaign_id && run.campaign_id!==campaignReceipt?.id)openDraft(run.campaign_id);
        setChosen({...run.brief.campaign,platform,budget_minor});
      }}/> : report.state==='error' ? <div role="alert" className="rc-message">{failure(report.error)} <button className="studio-secondary" onClick={readReport}>Retry reading</button></div> : <p role="status" className="rc-message">Checking current permissions and opening the findings…</p>}
      <details className="rc-method"><summary>Source checks for this run</summary><ul>{run.sources.map(s=><li key={s.key}>{s.name} · {s.pending?'Collection pending at analysis':s.error?'Source temporarily unavailable':s.state.replaceAll('_',' ')}</li>)}</ul></details>
      <div className="rc-actions"><button className="studio-secondary" onClick={()=>onAdjust(run.brief)}>Adjust brief</button><button className="studio-secondary" disabled={!!action} onClick={()=>void command('resume')}>Refresh evidence</button>{run.campaign_id && <Link to={path('campaigns')}>Company campaigns</Link>}</div>
    </> : <Panel title={phases[run.state]} description={active(run.state)?'You can leave this page. The company will keep the brief and its progress.':undefined}>
      <ol className="rc-steps">{(['queued','collecting','analyzing','ready'] as const).map((step,i)=><li key={step} aria-current={step===run.state?'step':undefined}><span>{i+1}</span>{['Review brief','Check eligible sources','Analyze and compare','Publish findings'][i]}</li>)}</ol>
      {run.sources.length>0 && <details className="rc-method" open={run.state==='collecting'}><summary>Source availability</summary><ul>{run.sources.map(s=><li key={s.key}><span>{s.name}</span> · {s.error?'Retry scheduled or source unavailable':s.pending?'Collection in progress':s.state.replaceAll('_',' ')}</li>)}</ul></details>}
      <div className="rc-actions">{active(run.state) ? <button disabled={!!action} className="studio-secondary" onClick={()=>void command('cancel')}>Cancel research</button> :
        <button disabled={!!action} className="studio-primary" onClick={()=>void command('resume')}>Resume research</button>}
        {run.state==='failed' && <p role="alert">The last attempt could not finish. Resume with the saved brief.</p>}</div>
      {run.error==='delivery_delayed' && <p role="status" className="rc-inset">The research worker is temporarily unavailable. Delivery will retry automatically.</p>}
    </Panel>}
    {error && <p className="rc-message" role="alert">{error}</p>}
  </div>;
}

function BriefForm({initial,query,onOpen}:{initial:BusinessBrief|null;query:string;onOpen:(id:string)=>void}) {
  const {draft,setDraft,campaignReceipt}=useMarketing();
  const initialCampaign=initial?.campaign ?? draft.evaluation;
  const [question,setQuestion]=useState(initial?.campaign.description ?? (query || initialCampaign?.description || draft.brief.description || ''));
  const [product,setProduct]=useState(initial?.product ?? draft.brief.name ?? '');
  const [audience,setAudience]=useState(initial?.audience ?? '');
  const [focus,setFocus]=useState(initial?.discovery_focus ?? query.slice(0,120));
  const [budget,setBudget]=useState(initialCampaign ? String(initialCampaign.budget_minor/100) : draft.brief.budget ? String(draft.brief.budget) : '');
  const [channel,setChannel]=useState<CampaignRequest['platform']>(initialCampaign?.platform ?? 'instagram');
  const [deliverable,setDeliverable]=useState<CampaignRequest['deliverable']>(initialCampaign?.deliverable ?? 'social_post');
  const [objective,setObjective]=useState<CampaignRequest['objective']>(initialCampaign?.objective ?? 'awareness');
  const [alternative,setAlternative]=useState<CampaignRequest['platform']|''>(initial?.alternative_platforms[0] ?? '');
  const [testShare,setTestShare]=useState(String(initial?.test_share ?? 60));
  const [required,setRequired]=useState(initialCampaign?.required_facts.join(', ') ?? '');
  const [preferred,setPreferred]=useState(initialCampaign?.preferred_facts.join(', ') ?? '');
  const [marketShare,setMarketShare]=useState(initialCampaign?.minimum_market_share!=null ? String(100*Number(initialCampaign.minimum_market_share)) : '');
  const [language,setLanguage]=useState<CampaignRequest['language']>(initialCampaign?.language);
  const [requireLanguage,setRequireLanguage]=useState(initialCampaign?.require_language ?? false);
  const [link,setLink]=useState(true);
  const [busy,setBusy]=useState(false);
  const [awaitingSave,setAwaitingSave]=useState<BusinessBrief|null>(null);
  const [error,setError]=useState('');
  const submission=useRef<{body:string;key:string} | null>(null);
  const live=useRef<AbortController|null>(null);
  useEffect(()=>()=>live.current?.abort(),[]);
  const send=useCallback(async (brief:BusinessBrief,id:string|null)=>{
    const body=JSON.stringify({brief,campaign_id:id});
    if(submission.current?.body!==body) submission.current={body,key:crypto.randomUUID()};
    const controller=new AbortController();
    live.current=controller;setBusy(true);setError('');
    try {
      const created=await apiPost<Run>(route,{brief,campaign_id:id,request_key:submission.current.key},controller.signal);
      if(!controller.signal.aborted) onOpen(created.id);
    } catch(cause){if(!controller.signal.aborted)setError(failure(cause));}
    finally{if(!controller.signal.aborted)setBusy(false);}
  },[onOpen]);
  useEffect(()=>{
    if(awaitingSave && campaignReceipt && campaignReceipt.version>0 && !campaignReceipt.pending){
      setAwaitingSave(null);void send(awaitingSave,campaignReceipt.id);
    }
  },[awaitingSave,campaignReceipt,send]);
  function submit(event:FormEvent) {
    event.preventDefault();
    if(busy || awaitingSave) return;
    const terms=(value:string)=>[...new Set(value.split(',').map(v=>v.trim()).filter(Boolean))];
    const must=terms(required), preferences=terms(preferred);
    if([...must,...preferences].some(v=>! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v)) || Math.max(must.length,preferences.length)>10){setError('Enter up to ten reviewed fact IDs per field, separated by commas.');return;}
    const campaign:CampaignRequest={
      market:'HK',minimum_creators:1,maximum_creators:4,
      ...initialCampaign, description:question.trim(),platform:channel,objective,deliverable,
      language,require_language:!!language && requireLanguage,required_facts:must,preferred_facts:preferences,
      minimum_market_share:marketShare==='' ? undefined : String(Number(marketShare)/100),
      budget_minor:Math.round(Number(budget)*100),currency:'HKD',
    };
    const brief:BusinessBrief={product:product.trim(),audience:audience.trim(),discovery_focus:focus.trim()||null,
      test_share:Number(testShare),alternative_platforms:alternative && alternative!==channel?[alternative]:[],campaign};
    if(link && campaignReceipt && (!campaignReceipt.version || campaignReceipt.pending)){
      if(!campaignReceipt.version) setDraft(old=>({...old,saved:true,brief:{...old.brief,name:brief.product,description:campaign.description,
        budget:campaign.budget_minor/100,platform:channel,objective,deliverable,market:'HK'},evaluation:campaign}));
      setAwaitingSave(brief);return;
    }
    void send(brief,link && campaignReceipt ? campaignReceipt.id:null);
  }
  function useExample(){setQuestion(example.question);setProduct(example.product);setAudience(example.audience);setFocus(example.focus);setBudget('12000');}
  return <Panel title="Write a research brief" description="Describe the decision you need to make. Harbourline will check eligible sources and compare options within your budget.">
    <form onSubmit={submit} className="rc-form"><label>What are you trying to find?<textarea value={question} onChange={e=>setQuestion(e.target.value)} minLength={2} maxLength={1000} required rows={3} placeholder="Describe your campaign and the evidence you need." /></label>
      <button type="button" className="rc-example" onClick={useExample}>Use a Hong Kong dining brief</button>
      <div className="rc-pair"><label>Product or campaign<input value={product} onChange={e=>setProduct(e.target.value)} required minLength={2} maxLength={160}/></label>
        <label>Target audience<input value={audience} onChange={e=>setAudience(e.target.value)} required minLength={2} maxLength={300}/></label></div>
      <div className="rc-triplet"><label>Budget cap (HK$)<input type="number" inputMode="decimal" min="0" max="10000000" step=".01" value={budget} required onChange={e=>setBudget(e.target.value)}/></label>
        <label>Objective<select value={objective} onChange={e=>setObjective(e.target.value as typeof objective)}><option value="awareness">Awareness</option><option value="engagement">Engagement</option></select></label>
        <label>Primary channel<select value={channel} onChange={e=>setChannel(e.target.value as typeof channel)}>{Object.entries(platformOptions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      <details className="rc-settings"><summary>Research scope and alternatives</summary>
        <label>Discovery focus<input maxLength={120} value={focus} onChange={e=>setFocus(e.target.value)} placeholder="Optional topic, creator or source phrase"/></label>
        <div className="rc-pair"><label>Required deliverable<select value={deliverable} onChange={e=>setDeliverable(e.target.value as typeof deliverable)}>{Object.entries(deliverableOptions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>Also compare<select value={alternative===channel?'':alternative} onChange={e=>setAlternative(e.target.value as typeof alternative)}><option value="">No other channel</option>{Object.entries(platformOptions).filter(([key])=>key!==channel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
        <label>Test allocation (% of full budget)<input type="number" min={10} max={90} required value={testShare} onChange={e=>setTestShare(e.target.value)}/></label>
        <div className="rc-pair"><label>Required market audience share (%)<input type="number" min={0} max={100} step=".01" placeholder="Optional" value={marketShare} onChange={e=>setMarketShare(e.target.value)}/></label><label>Content language<select value={language??''} onChange={e=>setLanguage(e.target.value ? e.target.value as CampaignRequest['language'] : undefined)}><option value="">Any language</option>{Object.entries(languageOptions).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label></div>
        {language && <label className="rc-check"><input type="checkbox" checked={requireLanguage} onChange={e=>setRequireLanguage(e.target.checked)}/>Require evidence of this language</label>}
        {(required || preferred || initialCampaign?.required_facts.length || initialCampaign?.preferred_facts.length) ? <div className="rc-pair"><label>Required reviewed facts<input value={required} onChange={e=>setRequired(e.target.value)}/></label><label>Preferred reviewed facts<input value={preferred} onChange={e=>setPreferred(e.target.value)}/></label></div> : null}
        {campaignReceipt && <label className="rc-check"><input type="checkbox" checked={link} onChange={e=>setLink(e.target.checked)}/>{campaignReceipt.version?'Link to the current company campaign':'Save this brief as a company campaign'}</label>}
      </details>
      {error && <p className="rc-error" role="alert">{error}</p>}
      <div className="rc-actions"><button className="studio-primary" disabled={busy||!!awaitingSave} type="submit">{awaitingSave?'Saving campaign…':busy?'Starting research…':'Start research'}</button>
        {awaitingSave && <button type="button" className="studio-secondary" onClick={()=>setAwaitingSave(null)}>Back to brief</button>}</div>
    </form>
  </Panel>;
}

export function ResearchCampaign() {
  const {company,path}=useMarketing();
  const [params,setParams]=useSearchParams();
  const [initial,setInitial]=useState<BusinessBrief|null>(null);
  const {result:history,retry}=useResource(loadHistory,0,true,!!company);
  const selected=params.get('run');
  const open=useCallback((id:string)=>{setParams({run:id});retry();},[setParams,retry]);
  function fresh(brief:BusinessBrief|null=null){setInitial(brief);setParams({});}
  if(!company) return <main className="rc-page"><PageHeader title="Campaign research" description="Sign in to a company workspace to run research with permitted sources and save your findings."/><Link className="studio-primary" to={path()}>Open company access</Link></main>;
  return <main className="rc-page"><PageHeader title="Campaign research" description={company.name} actions={selected?<button className="studio-secondary" onClick={()=>fresh()}>New research</button>:undefined}/>
    <div className="rc-layout"><div>{selected ? <RunDetail key={selected} id={selected} onAdjust={fresh} onRefresh={retry}/> : <BriefForm key={params.get('q')??''} query={params.get('q')?.slice(0,1000)??''} initial={initial} onOpen={open}/>}</div>
      <aside className="rc-history" aria-label="Recent research"><h2>Recent research</h2>
        {history.state==='error' ? <button className="studio-secondary" onClick={retry}>Retry history</button> : history.state==='loading' ? <p>Loading…</p> : history.data.length===0 ? <p>Your company’s saved research will appear here.</p> :
          <ul>{history.data.map(run=><li key={run.id}><button aria-current={selected===run.id?'page':undefined} onClick={()=>open(run.id)}><strong>{run.brief.product}</strong><span>{phases[run.state]} · {date(run.created_at)}</span></button></li>)}</ul>}
      </aside></div></main>;
}
