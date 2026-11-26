import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, ScrollRestoration, useLocation, useNavigate } from 'react-router';
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
import { CompanyControls } from './CompanyAccess';
import { OverviewAnalytics } from './Overview';
import { PublicCreatorDirectory } from './PublicCreatorDirectory';
import './marketing.css';
import './analytics.css';

function Home({ capability, serverDemo, apiMode }: { capability: ReactNode; serverDemo: boolean; apiMode?: DataMode }) {
  const { draft, demo, mode, path, otherDrafts, openDraft } = useMarketing();
  const navigate = useNavigate();
  const saved = otherDrafts();
  return <div className="hl-page hl-overview">
    <div className="hl-page-heading"><div><h1>Workspace overview</h1><p>Creator coverage and campaign activity in your workspace.</p></div>
      <Link className="hl-button hl-primary" to={path('advisor')}>{draft.saved ? 'Open Campaign Advisor' : 'Start a campaign'} <span aria-hidden="true">↗</span></Link></div>
    <OverviewAnalytics mode={apiMode}/>
    {!apiMode && !demo && <section className="hl-availability">{capability}{mode==='partner' && <div className="hl-actions">{serverDemo && <Link to="/demo/connected">Open backend demo</Link>}<Link to="/demo">Open fictional demo</Link></div>}</section>}
    <section className="hl-campaigns"><div className="hl-row-between"><h2>Campaign drafts</h2>{!demo && draft.saved && <button onClick={()=>{openDraft();navigate(path('advisor'));}}>Start another campaign</button>}</div>
      {draft.saved ? <div className="hl-draft-row"><Link to={path('advisor')}>{draft.brief.name}</Link><span>{fee(draft.brief.budget)} budget · {draft.brief.creatorCount} creator slots</span></div>
      : <p>Start a campaign to save a brief, shortlist and budget.</p>}
      {saved.map(item=><button className="hl-text-button" key={item.key} onClick={()=>{openDraft(item.key);navigate(path('advisor'));}}>{item.name}</button>)}
    </section>
  </div>;
}

function MarketingShell({ capabilityRequest }: { capabilityRequest: ReturnType<typeof useResource<MarketingCapability>> }) {
  const { demo, mode, draft, path, storageFailed } = useMarketing();
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  const { result, retry } = capabilityRequest;
  const navigate = useNavigate();
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('query') ?? '').trim();
    navigate(path('creators') + (query ? '?' + new URLSearchParams({q:query}) : ''));
  }
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

  return <div className="harbour dark">
    <ScrollRestoration />
    <a className="skip-link" href="#harbour-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to main content</a>
    <header className="hl-navigation"><div className="hl-navigation-top"><Link className="hl-wordmark" to={path()}><Brand/></Link>
      {pathname !== path('creators') && <form role="search" aria-label="Workspace search" onSubmit={search}><input name="query" aria-label="Creator name, handle or topic" placeholder="Search creators or topics" minLength={2} maxLength={100}/><button aria-label="Search creators" type="submit">↵</button></form>}
      <CompanyControls/>{mode !== 'partner' && <div className="hl-mode"><strong>{demo ? 'Fictional demo' : 'Fictional backend demo'}</strong><Link to={__PLATFORM_SYNTHETIC_DEMO__ ? '/workspace' : '/'}>Live workspace</Link></div>}
    </div><div className="hl-nav-rule"><nav aria-label="Marketing workspace">
      <NavLink end to={path()}>Workspace</NavLink><NavLink aria-label="Creator Explorer" to={creatorPath}><span className="hl-nav-prefix">Creator </span>Explorer</NavLink>
      {apiMode==='partner' && <NavLink aria-label="Public directory" to={path('directory')}><span className="hl-nav-prefix">Public </span>Directory</NavLink>}
      <NavLink aria-label="Campaign Advisor" to={path('advisor')}><span className="hl-nav-prefix">Campaign </span>Advisor</NavLink><NavLink aria-label="Campaign plan" to={path('plan')}><span className="hl-nav-desktop">Campaign plan</span><span className="hl-nav-mobile">Plan</span></NavLink></nav></div></header>
    <main id="harbour-main" tabIndex={-1} ref={main}>
      {storageFailed && <p className="hl-storage" role="alert">This browser could not save the draft. Open work stays available for this session.</p>}
      <CatalogUpdates mode={apiMode}><Routes>
        <Route path={path()} element={<Home capability={capability} serverDemo={serverDemo} apiMode={apiMode} />} />
        {mode === 'partner' && <Route path={path('directory')} element={apiMode ? <PublicCreatorDirectory/> : capability}/>}
        <Route path={path('advisor')} element={<Advisor capability={capability} mode={apiMode} />} />
        <Route path={path('creators')} element={<CreatorExplorer capability={capability} mode={apiMode} />} />
        <Route path={path('plan')} element={apiMode ? <ConnectedPlan mode={apiMode} />
          : !demo && (result.state === 'loading' || mode === 'server-demo') ? capability : <CampaignPlan />} />
        <Route path="*" element={<div className="hl-page"><h1>Page unavailable</h1><Link to={path()}>Open workspace</Link></div>} />
      </Routes></CatalogUpdates>
    </main>
  </div>;
}

export function MarketingWorkspace({ mode }: { mode: WorkspaceMode }) {
  const capabilityRequest = useResource(getMarketingCapability, 0, false, mode !== 'sample');
  const { result } = capabilityRequest;
  if (mode === 'partner' && result.state === 'loading') return <Loading>Opening workspace…</Loading>;
  return <MarketingDraft mode={mode} key={mode} companyEnabled={result.state === 'ready' && result.data.company_accounts}><MarketingShell capabilityRequest={capabilityRequest} /></MarketingDraft>;
}
