import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { Loading, RequestProblem } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getMarketingCapability } from './api';
import { Advisor } from './Advisor';
import { ConnectedPlan } from './ConnectedPlan';
import type { DataMode } from './intelligence';
import { CampaignPlan } from './CampaignPlan';
import { Brand } from './components';
import { CreatorExplorer } from './CreatorExplorer';
import { fee } from './contracts';
import { MarketingDraft, useMarketing, type WorkspaceMode } from './workspace';
import './marketing.css';

function Home({ capability, serverDemo }: { capability: ReactNode; serverDemo: boolean }) {
  const { draft, demo, mode, path } = useMarketing();
  const navigate = useNavigate();

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('query') ?? '').trim();
    navigate(query ? path('creators') + '?' + new URLSearchParams({ q: query }) : path('creators'));
  }

  return <div className="hl-home hl-page">
    <section className="hl-home-intro">
      <div>
        <h1>Plan a creator campaign</h1>
        <p>Describe your campaign, review creator evidence and build a plan for your Hong Kong launch.</p>
        <div className="hl-actions"><Link className="hl-button hl-primary" to={path('advisor')}>{draft.saved ? 'Open Campaign Advisor' : 'Start a campaign'}</Link>
          <Link className="hl-button" to={path('creators')}>Explore creators</Link></div>
      </div>
      <aside className="hl-home-aside" aria-label="Draft and data availability">
        <h2>{draft.saved ? 'Current campaign draft' : 'Campaign drafts'}</h2>
        {draft.saved ? <><Link className="hl-campaign-link" to={path('advisor')}>{draft.brief.name}</Link>
          <p>{fee(draft.brief.budget)} budget · {draft.brief.creatorCount} creator slots</p></> : <p>Start a brief to keep your campaign scope and planning assumptions in this browser.</p>}
        {demo ? <div className="hl-home-state"><strong>Fictional demo</strong><p>Sample creators, quotes and evidence use a Sheung Wan coffee launch.</p></div>
          : <div className="hl-home-state">{capability}{mode === 'partner' && <div className="hl-actions">
              {serverDemo && <Link to="/demo/connected">Open backend demo</Link>}
              <Link to="/demo">Open fictional demo <span aria-hidden="true">↗</span></Link>
            </div>}</div>}
      </aside>
    </section>
    <section className="hl-home-search" aria-labelledby="hl-home-search-heading">
      <h2 id="hl-home-search-heading">Search creators</h2>
      <form role="search" aria-label="Search creators" onSubmit={search}>
        <label className="hl-sr" htmlFor="hl-home-query">Creator name, handle or topic</label>
        <input id="hl-home-query" name="query" placeholder="Creator name, handle or topic" maxLength={100} />
        <button type="submit">Search</button>
      </form>
    </section>
  </div>;
}

function MarketingShell() {
  const { demo, mode, draft, path, storageFailed } = useMarketing();
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);
  const { result, retry } = useResource(getMarketingCapability, 0, false, !demo);
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

  return <div className="harbour">
    <ScrollRestoration />
    <a className="skip-link" href="#harbour-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to main content</a>
    <header className="hl-topbar">
      <Link to={path()}><Brand /></Link>
      <nav aria-label="Marketing workspace"><NavLink end to={path()}>Workspace</NavLink><NavLink to={path('advisor')}>Campaign Advisor</NavLink>
        <NavLink to={creatorPath}>Creator Explorer</NavLink><NavLink to={path('plan')}>Campaign plan</NavLink></nav>
      {mode !== 'partner' && <div className="hl-mode"><strong>{demo ? 'Fictional demo' : 'Fictional backend demo'}</strong><Link to={__PLATFORM_SYNTHETIC_DEMO__ ? "/workspace" : "/"}>Live workspace</Link></div>}
    </header>
    <main id="harbour-main" tabIndex={-1} ref={main}>
      {storageFailed && <p className="hl-storage" role="alert">This browser could not save the draft. Open work stays available for this session.</p>}
      <Routes>
        <Route path={path()} element={<Home capability={capability} serverDemo={serverDemo} />} />
        <Route path={path('advisor')} element={<Advisor capability={capability} mode={apiMode} />} />
        <Route path={path('creators')} element={<CreatorExplorer capability={capability} mode={apiMode} />} />
        <Route path={path('plan')} element={apiMode ? <ConnectedPlan mode={apiMode} /> : <CampaignPlan />} />
        <Route path="*" element={<div className="hl-page"><h1>Page unavailable</h1><Link to={path()}>Open workspace</Link></div>} />
      </Routes>
    </main>
  </div>;
}

export function MarketingWorkspace({ mode }: { mode: WorkspaceMode }) {
  return <MarketingDraft mode={mode} key={mode}><MarketingShell /></MarketingDraft>;
}