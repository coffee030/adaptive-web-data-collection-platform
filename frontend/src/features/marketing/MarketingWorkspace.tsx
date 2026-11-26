import { useEffect, useRef, type ReactNode } from 'react';
import { Link, Route, Routes, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { Loading, RequestProblem } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getMarketingCapability, type MarketingCapability } from './api';
import { Advisor } from './Advisor';
import { ConnectedPlan } from './ConnectedPlan';
import type { DataMode } from './intelligence';
import { CampaignPlan } from './CampaignPlan';
import { Brand } from './components';
import { CreatorExplorer } from './CreatorExplorer';
import { fee } from './contracts';
import { CatalogUpdates } from './CatalogUpdates';
import { MarketingDraft, useMarketing, type WorkspaceMode } from './workspace';
import { WorkspaceDestination } from './WorkspaceDestination';
import { CompanyControls } from './CompanyAccess';
import { OverviewAnalytics } from './Overview';
import { SidebarNavigation, type MenuGroup } from '../../components/tailadmin/SidebarNavigation';
import { LayoutGridIcon, GlobeIcon, FolderOpenIcon, SearchIcon, ShootingStarIcon, BarChartIcon } from '../../components/tailadmin/icons';
import { ResearchProvider, useResearch } from './ResearchBrief';
import { PublishedWorks } from './PublishedWorks';
import { ResearchPlan } from './ResearchPlan';
import { BusinessWorkspace } from './BusinessWorkspace';
import { PublicCreatorDirectory } from './PublicCreatorDirectory';
import './marketing.css';
import './analytics.css';
import './research-workspace.css';

function Home({ capability, serverDemo, apiMode }: { capability: ReactNode; serverDemo: boolean; apiMode?: DataMode }) {
  const { draft, demo, mode, path, otherDrafts, openDraft } = useMarketing();
  const navigate = useNavigate();
  const saved = otherDrafts();
  const {brief:research}=useResearch();
  const directory = apiMode === 'partner' || (mode === 'server-demo' && __HARBOURLINE_INSTALLATION__ === 'demo');
  const campaignAction = <Link to={path('advisor')}>{draft.saved ? 'Open Campaign Advisor' : 'Start a campaign'}</Link>;
  return <div className="hl-page hl-overview">
    {directory ? <section className="hl-first-search"><h1>Find Hong Kong creators</h1>
      <p>Find contributors through their published work. Review the sources, compare leads and prepare a campaign brief.</p>
      <form role="search" aria-label="Start public directory research" onSubmit={event => {
        event.preventDefault(); const q = String(new FormData(event.currentTarget).get('topic') ?? '').trim();
        navigate(path('directory') + (q ? '?' + new URLSearchParams({q}) : ''));
      }}><label htmlFor="starting-topic">Creator name or topic</label><div><input id="starting-topic" name="topic" maxLength={120} defaultValue="affordable dining"/><button className="hl-primary">Search public directory</button></div></form>
      <p className="hl-note">Wikimedia Commons works · Wikidata identities</p>
    </section> : <>
    <div className="hl-page-heading"><div><h1>Workspace overview</h1><p>Creator coverage and campaign activity in your workspace.</p></div>
      <Link className="hl-button hl-primary" to={path('advisor')}>{draft.saved ? 'Open Campaign Advisor' : 'Start a campaign'} <span aria-hidden="true">↗</span></Link></div>
    </>}
    {directory && <div className="hl-home-desk"><PublishedWorks isolated={mode==='server-demo'} query="affordable dining" preview/>
      <aside className="hl-home-brief"><FolderOpenIcon aria-hidden="true"/><h2>{research.title || 'Your research shortlist'}</h2><p>{research.leads.length ? research.leads.length+' saved '+(research.leads.length===1?'lead':'leads') : 'Save a contributor to compare their work and prepare a request for rates.'}</p><Link to={path('research-plan')}>Open research shortlist →</Link></aside></div>}
    {!apiMode && !demo && <section className="hl-availability">{capability}{mode==='partner' && <div className="hl-actions">{serverDemo && <Link to="/demo/connected">Open backend demo</Link>}<Link to="/demo">Open fictional demo</Link></div>}</section>}
    <section className="hl-campaigns"><div className="hl-row-between"><h2>{directory && mode === 'server-demo' ? 'Fictional campaign practice' : 'Campaign drafts'}</h2>{directory && campaignAction}{!demo && draft.saved && <button onClick={()=>{openDraft();navigate(path('advisor'));}}>Start another campaign</button>}</div>
      {draft.saved ? <div className="hl-draft-row"><Link to={path('advisor')}>{draft.brief.name}</Link><span>{fee(draft.brief.budget)} budget · {draft.brief.creatorCount} {draft.brief.creatorCount===1?'creator slot':'creator slots'}</span></div>
      : <p>Start a campaign to save a brief, shortlist and budget.</p>}
      {saved.map(item=><button className="hl-text-button" key={item.key} onClick={()=>{openDraft(item.key);navigate(path('advisor'));}}>{item.name}</button>)}
    </section>
    {directory ? <details className="hl-coverage-fold"><summary>{mode==='server-demo' ? 'Fictional catalog coverage' : 'Company catalog coverage'}</summary><OverviewAnalytics mode={apiMode}/></details> : <OverviewAnalytics mode={apiMode}/>}
  </div>;
}

function MarketingShell({ capabilityRequest }: { capabilityRequest: ReturnType<typeof useResource<MarketingCapability>> }) {
  const { demo, mode, draft, path, storageFailed, company, campaignReceipt } = useMarketing();
  const { pathname, search } = useLocation();
  const directoryMemory = useRef({ owner:'', search:'' });
  const owner = [mode,company?.id,company?.username,campaignReceipt?.id].join('/');
  useEffect(()=>{
    if(pathname===path('directory')) directoryMemory.current={owner,search};
  },[owner,pathname,search,path]);
  const lastPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  const { result, retry } = capabilityRequest;
  const serverDemo = result.state === 'ready' && result.data.demo_intelligence === 'available';
  const apiMode: DataMode | undefined = result.state === 'ready'
    ? mode === 'server-demo' && serverDemo ? 'demo'
      : mode === 'partner' && result.data.customer_intelligence === 'available' ? 'partner' : undefined
    : undefined;
  const creatorPath = path('creators') + (draft.explorer ? '?' + draft.explorer : '');

  useEffect(() => {
    const page = pathname.split('/').filter(Boolean).at(-1);
    const title = page === 'advisor' ? 'Campaign Advisor' : page === 'creators' ? 'Creator Explorer'
      : page === 'plan' ? 'Campaign plan' : 'Campaign workspace';
    document.title = title + (mode !== 'partner' ? ' | Harbourline fictional demo' : ' | Harbourline');
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      main.current?.focus({ preventScroll: true });
    }
  }, [pathname, mode]);

  const capability = result.state === 'loading' ? <Loading>Checking live creator availability…</Loading>
    : result.state === 'error' ? result.error.status === 404 ? <div className="hl-state"><strong>Marketing service unavailable</strong>
      <p>This deployment does not expose marketing capabilities.</p><button type="button" onClick={retry}>Retry</button></div>
      : <RequestProblem error={result.error} resource="marketing capabilities" retry={retry} />
    : apiMode ? <div className="hl-state"><strong>{apiMode === 'demo' ? 'Backend demo available' : 'Partner workspace configured'}</strong>
      <p>{apiMode === 'demo' ? 'Fictional records served by the campaign intelligence API.' : 'Access and dataset eligibility are checked by the intelligence API.'}</p></div>
    : mode === 'server-demo' ? <div className="hl-state" role="status"><strong>Backend demo unavailable</strong>
      <p>This deployment has not enabled its fictional dataset workspace.</p></div>
    : <div className="hl-state" role="status"><strong>Live creator intelligence unavailable</strong>
      <p>Current YouTube permissions cover approved research only. Customer recommendations require eligible data.</p></div>;

  const hasDirectory=apiMode==='partner'||(mode==='server-demo' && __HARBOURLINE_INSTALLATION__==='demo');
  const publicScreen=hasDirectory && [path(),path('directory'),path('research-plan')].includes(pathname);
  const sourceLabel=publicScreen?'Public source research':mode==='sample'?'Fictional demo':mode==='server-demo'?'Fictional backend demo':'Company workspace';
  const groups:MenuGroup[]=[
    {label:'Research',items:[
      {to:path(),name:'Workspace',compact:'Workspace',icon:LayoutGridIcon},
      ...(hasDirectory ? [
        {to:path('directory')+(directoryMemory.current.owner===owner ? directoryMemory.current.search : ''),name:'Public directory',compact:'Directory',icon:GlobeIcon},
        {to:path('research-plan'),name:'Research shortlist',compact:'Shortlist',icon:FolderOpenIcon},
      ]:[]),
    ]},
    {label:hasDirectory && mode==='server-demo'?'Fictional campaign practice':'Campaign planning',items:[
      {to:creatorPath,name:'Creator Explorer',compact:'Explorer',icon:SearchIcon},
      {to:path('advisor'),name:'Campaign Advisor',compact:'Advisor',icon:ShootingStarIcon},
      {to:path('plan'),name:'Campaign plan',compact:'Plan',icon:BarChartIcon},
    ]},
  ];

  return <div className="harbour dark hl-application">
    <ScrollRestoration />
    <a className="skip-link" href="#harbour-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to main content</a>
    <SidebarNavigation groups={groups} brand={<Link to={path()} aria-label="Harbourline home"><Brand/></Link>} footer={
      mode==='partner' ? <span>Company workspace</span> : <WorkspaceDestination destination="pilot"/>}/>
    <div className="hl-workspace-inset" data-slot="sidebar-inset"><header className="hl-workspace-header">
      <span className="hl-location"><span className="hl-location-dot" aria-hidden="true"/>{sourceLabel}</span>
      {mode!=='partner' && <div className="hl-mobile-peer"><WorkspaceDestination destination="pilot"/></div>}
      <CompanyControls/>
    </header>
    <main id="harbour-main" tabIndex={-1} ref={main}>
      {storageFailed && <p className="hl-storage" role="alert">This browser could not save the draft. Open work stays available for this session.</p>}
      <CatalogUpdates mode={apiMode}><Routes>
        <Route path={path()} element={<Home capability={capability} serverDemo={serverDemo} apiMode={apiMode} />} />
        {(mode === 'partner' || (mode === 'server-demo' && __HARBOURLINE_INSTALLATION__ === 'demo')) && <Route path={path('directory')} element={apiMode || mode === 'server-demo' ? <PublicCreatorDirectory isolatedDemo={mode==='server-demo'}/> : capability}/>}
        {hasDirectory && <Route path={path('research-plan')} element={<ResearchPlan isolated={mode==='server-demo'}/>}/>}
        <Route path={path('advisor')} element={<Advisor capability={capability} mode={apiMode} />} />
        <Route path={path('creators')} element={<CreatorExplorer capability={capability} mode={apiMode} />} />
        <Route path={path('plan')} element={apiMode ? <ConnectedPlan mode={apiMode} />
          : !demo && (result.state === 'loading' || mode === 'server-demo') ? capability : <CampaignPlan />} />
        <Route path="*" element={<div className="hl-page"><h1>Page unavailable</h1><Link to={path()}>Open workspace</Link></div>} />
      </Routes></CatalogUpdates>
    </main>
  </div></div>;
}

export function MarketingWorkspace({ mode }: { mode: WorkspaceMode }) {
  const capabilityRequest = useResource(getMarketingCapability, 0, false, mode !== 'sample');
  const { result } = capabilityRequest;
  if (mode === 'partner' && __HARBOURLINE_INSTALLATION__ !== 'pilot' && result.state === 'loading') return <Loading>Opening workspace…</Loading>;
  return <MarketingDraft mode={mode} key={mode} companyEnabled={__HARBOURLINE_INSTALLATION__ === 'pilot' || (result.state === 'ready' && result.data.company_accounts)}><ResearchProvider>{mode==='partner' && (__HARBOURLINE_INSTALLATION__==='pilot' || (result.state==='ready' && result.data.company_accounts)) ? <BusinessWorkspace/> : <MarketingShell capabilityRequest={capabilityRequest} />}</ResearchProvider></MarketingDraft>;
}
