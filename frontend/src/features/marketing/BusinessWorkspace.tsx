import { useEffect, useRef, lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, ScrollRestoration, useLocation } from 'react-router';
import { WorkspaceNav } from '../../components/studio/Workspace';
import { LayoutGridIcon, GlobeIcon, FolderOpenIcon, SearchIcon, ShootingStarIcon, BarChartIcon } from '../../components/tailadmin/icons';
import { CompanyControls } from './CompanyAccess';
import { Brand } from './components';
import { CampaignDetail, CampaignDesk } from './CampaignDesk';
import { MarketDiscovery, MarketProfile } from './MarketDiscovery';
import { MarketOverview, PlatformAnalysis } from './MarketOverview';
import { CreatorExplorer } from './CreatorExplorer';
import { Advisor } from './Advisor';
import { ConnectedPlan } from './ConnectedPlan';
import { CatalogUpdates } from './CatalogUpdates';
import { useMarketing } from './workspace';
import './business.css';

const Research = lazy(async()=>({default:(await import('./ResearchCampaign')).ResearchCampaign}));
const navigation=[
  {label:'Intelligence',items:[{to:'/',name:'Market overview',icon:<LayoutGridIcon/>},{to:'/creators',name:'Creator discovery',icon:<SearchIcon/>,end:false},{to:'/platforms',name:'Platform analysis',icon:<GlobeIcon/>},{to:'/research',name:'Campaign Advisor',icon:<ShootingStarIcon/>,end:false}]},
  {label:'Campaign work',items:[{to:'/campaigns',name:'Campaigns',icon:<FolderOpenIcon/>,end:false},{to:'/reports',name:'Performance reports',icon:<BarChartIcon/>,end:false}]},
];

export function BusinessWorkspace() {
  const {pathname}=useLocation();
  const {draft,campaignReceipt}=useMarketing();
  const main=useRef<HTMLElement>(null);
  const last=useRef(pathname);
  useEffect(()=>{
    const parts=pathname.split('/').filter(Boolean);
    const title=({creators:'Creator discovery',platforms:'Platform analysis',research:'Campaign Advisor',campaigns:'Campaigns',reports:'Performance reports',advisor:'Campaign brief',plan:'Campaign plan'} as Record<string,string>)[parts[0]??'']??'Market overview';
    document.title=title+' | Harbourline';
    if(last.current!==pathname){last.current=pathname;main.current?.focus({preventScroll:true});}
  },[pathname]);
  return <div className="harbour dark studio business-workspace" data-workspace="marketing"><ScrollRestoration/>
    <a className="skip-link" href="#business-main" onClick={e=>{e.preventDefault();main.current?.focus();}}>Skip to main content</a>
    <WorkspaceNav label="Marketing navigation" brand={<Link to="/" aria-label="Harbourline home"><Brand/></Link>} groups={navigation}
      footer={<Link to="/operations">Scraping Operations ↗</Link>}/>
    <div className="business-sheet"><header className="business-mast"><span>Marketing Intelligence</span>{draft.saved && campaignReceipt && <Link className="active-campaign" to={'/campaigns/'+campaignReceipt.id}>{draft.brief.name||'Active campaign'}</Link>}<CompanyControls/></header>
      <main id="business-main" ref={main} tabIndex={-1}><Routes>
        <Route index element={<MarketOverview/>}/><Route path="/workspace" element={<Navigate replace to="/"/>}/>
        <Route path="/creators" element={<MarketDiscovery/>}/><Route path="/creators/:id" element={<MarketProfile/>}/>
        <Route path="/creators/company" element={<><nav className="business-tabs company-evidence-tabs" aria-label="Creator catalog"><Link to="/creators">Published work</Link><span aria-current="page">Company evidence</span></nav><CatalogUpdates mode="partner"><CreatorExplorer mode="partner" capability={null}/></CatalogUpdates></>}/>
        <Route path="/platforms" element={<PlatformAnalysis/>}/><Route path="/research" element={<Suspense fallback={<p role="status">Opening Campaign Advisor…</p>}><Research/></Suspense>}/>
        <Route path="/campaigns" element={<CampaignDesk/>}/><Route path="/campaigns/:id" element={<CampaignDetail/>}/><Route path="/reports" element={<CampaignDesk reports/>}/><Route path="/reports/:id" element={<CampaignDetail report/>}/>
        <Route path="/advisor" element={<CatalogUpdates mode="partner"><Advisor mode="partner" capability={null}/></CatalogUpdates>}/><Route path="/plan" element={<CatalogUpdates mode="partner"><ConnectedPlan mode="partner"/></CatalogUpdates>}/>
        <Route path="/directory" element={<LegacyDiscovery/>}/><Route path="/research-plan" element={<Navigate replace to="/campaigns"/>}/>
        <Route path="*" element={<div className="business-empty"><h1>Page unavailable</h1><Link to="/">Open market overview</Link></div>}/>
      </Routes></main></div></div>;
}

function LegacyDiscovery(){const {search}=useLocation();return <Navigate replace to={'/creators'+search}/>;}
