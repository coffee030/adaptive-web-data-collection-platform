import { useState } from 'react';
import { Panel } from '../../components/studio/Workspace';
import { amount, date, platformOptions, type CampaignRequest, type Observed } from './intelligence';

export interface BusinessBrief {
  campaign: CampaignRequest;
  product: string;
  audience: string;
  discovery_focus: string | null;
  test_share: number;
  alternative_platforms: CampaignRequest['platform'][];
}

interface Finding {
  id: string;
  name: string;
  title: string;
  excerpt?: string;
  url: string;
  profile_url: string;
  platform: string;
  published_at: string | null;
  observed_at: string;
  license_url: string;
  basis: string;
  metrics: { label: string; value: number }[];
  visual_evidence?: { source_text: string; interpretation: string };
}

interface Candidate {
  id: string;
  name: string;
  selected: boolean;
  eligible: boolean;
  limitations: string[];
  content: Observed<{ text: string; published_at: string }> | null;
  quote: Observed<{ amount_minor: number; valid_until: string; terms: string }> | null;
  audience: Observed<{ market: string; share: string | null }> | null;
  historical: { median_views: { value: string | null; observations: number | null } };
  factors: Record<string, number | null>;
}

interface Strategy {
  name: string;
  platform: CampaignRequest['platform'];
  budget_minor: number;
  currency: string;
  status: string;
  selected: string[];
  allocated_minor: number | null;
  reviewed: number;
  exclusions: Record<string, number>;
  candidates: Candidate[];
  suggested_topics: string[];
}

export interface ResearchReport {
  run_id: string;
  analyzed_at: string;
  research: {
    focus: string;
    market_ranking: string;
    historical_ranking: string;
    historical_criteria: string;
    examples: Finding[];
    platform_activity: { platform: string; activities: number; creators: number; with_metrics: number }[];
  };
  strategies: Strategy[];
  next_steps: string[];
  outcome_basis: string;
}
const evidences: Record<string,string> = {
  market_activity: 'Published activity', related_market_activity: 'Related topic',
  identity_lead: 'Directory identity', historical_cost: 'Dated price evidence',
  historical_topic: 'Historical work', creator: 'Credited work', browse: 'Historical work',
};
const statuses: Record<string,string> = { optimal:'Quoted allocation available', needs_evidence:'Evidence needed', infeasible:'No verified combination fits', search_limit:'Selection limit reached' };
const reasons: Record<string,string> = {
  insufficient_relevant_content: 'Relevant content is missing', confirmed_quote_unavailable:'Current firm quote missing',
  quote_exceeds_budget:'Firm quote exceeds the cap', required_market_share_unverified:'Required audience share unverified',
  required_market_share_below_minimum:'Audience share below minimum', required_language_unverified:'Required language unverified',
};
function explain(value:string) { return reasons[value] ?? value.replace('required_fact_unverified:', 'Evidence needed for ').replaceAll('_',' '); }

function EvidenceList({report}:{report:ResearchReport}) {
  const [more,setMore] = useState(false);
  const {examples, platform_activity} = report.research;
  return <Panel title="Source evidence" description={`Research focus · ${report.research.focus}`}>
    {examples.length === 0 ? <p className="rc-inset">No public record matched. Edit the discovery focus to try another topic.</p> :
      <ol className="rc-evidence">{(more ? examples : examples.slice(0,5)).map(item =>
        <li key={item.platform+'/'+item.id}>
          <div className="rc-evidence-meta">{evidences[item.basis] ?? 'Published activity'} <span>·</span> {item.platform} {item.published_at && <> <span>·</span> {date(item.published_at)}</>}</div>
          <a className="rc-work-title" href={item.url} target="_blank" rel="noreferrer">{item.title} <span aria-hidden="true">↗</span></a>
          <div className="rc-byline">By <a href={item.profile_url} target="_blank" rel="noreferrer">{item.name}</a></div>
          {item.excerpt && <p>{item.excerpt}</p>}
          {item.visual_evidence && <p><strong>In the source</strong> {item.visual_evidence.source_text} · {item.visual_evidence.interpretation}</p>}
          {item.metrics.length>0 && <div className="rc-observation">{item.metrics.map(m => `${m.value.toLocaleString('en-HK')} ${m.label}`).join(' · ')}</div>}
          <div className="rc-origin">Observed {date(item.observed_at)} · <a href={item.license_url} target="_blank" rel="noreferrer">Source licence</a></div>
        </li>)}</ol>}
    {examples.length>5 && <button className="studio-secondary rc-more" onClick={()=>setMore(!more)}>{more?'Show fewer sources':`Show all ${examples.length} sources`}</button>}
    {platform_activity.length>0 && <div className="rc-inset"><h3>Activity in the reviewed results</h3><div role="region" aria-label="Observed platform coverage" tabIndex={0} className="studio-table-scroll"><table className="studio-table">
      <thead><tr><th>Platform</th><th>Creators</th><th>Activities</th><th>With measurements</th></tr></thead><tbody>{platform_activity.map(p=><tr key={p.platform}><th>{p.platform}</th><td>{p.creators}</td><td>{p.activities}</td><td>{p.with_metrics}</td></tr>)}</tbody></table></div></div>}
    {(report.research.historical_criteria || examples.length>0) && <details className="rc-method"><summary>How sources were matched</summary>
      <p>{report.research.historical_criteria} Source-linked market records use {report.research.market_ranking==='granite_int8'?'multilingual Granite similarity':report.research.market_ranking==='character_tfidf'?'text similarity':'the publication search'} to order matches. Related topics are labeled separately. A public work establishes authorship and content context. Audience and sponsorship terms require separate evidence.</p></details>}
  </Panel>;
}

function Options({report}:{report:ResearchReport}) {
  const [index,setIndex] = useState(0);
  const option = report.strategies[index];
  if (!option) return null;
  return <Panel title="Strategy comparison" description="Each option uses the same requirements and currency. Only a current firm quote can fund a place.">
    <div className="studio-table-scroll" role="region" aria-label="Campaign strategies" tabIndex={0}><table className="studio-table rc-strategy-table">
      <thead><tr><th>Option</th><th>Budget cap</th><th>Quoted spend</th><th>Decision</th></tr></thead>
      <tbody>{report.strategies.map((s,i)=><tr key={s.name+s.platform}><th><button aria-pressed={i===index} onClick={()=>setIndex(i)}>{s.name}<small>{platformOptions[s.platform]}</small></button></th><td>{amount(s.budget_minor,s.currency)}</td><td>{s.allocated_minor==null?'Unavailable':amount(s.allocated_minor,s.currency)}</td><td>{statuses[s.status] ?? s.status}</td></tr>)}</tbody></table></div>
    <div className="rc-inset"><h3>{option.name} · {platformOptions[option.platform]}</h3>
      <p>{option.reviewed ? `${option.reviewed} creator profiles reviewed for this channel. ${option.selected.length} in the verified allocation.` : 'This company has no authorized creator profiles on the selected channel. Public leads can guide outreach for quotes.'}</p>
      {option.allocated_minor!=null && <p>{amount(option.budget_minor-option.allocated_minor,option.currency)} remains under this option’s cap.</p>}
      {Object.entries(option.exclusions).length>0 && <ul>{Object.entries(option.exclusions).map(([reason,n])=><li key={reason}>{explain(reason)} · {n}</li>)}</ul>}
      {option.candidates.map(c=><details className="rc-candidate" key={c.id}><summary>{c.name}<span>{c.selected?'Selected':c.eligible?'Eligible':'Needs evidence'}</span></summary>
        {c.content && <blockquote>{c.content.data.text}<footer>{c.content.evidence.attribution} · {c.content.evidence.reference} · {date(c.content.data.published_at)}</footer></blockquote>}
        <p>{c.quote ? `Firm quote ${amount(c.quote.data.amount_minor,option.currency)} · valid through ${date(c.quote.data.valid_until)} · ${c.quote.data.terms} · ${c.quote.evidence.reference}` : 'No eligible firm quote.'}</p>
        <p>{c.audience?.data.share!=null ? `${c.audience.data.market} audience share ${(100*Number(c.audience.data.share)).toFixed(1)}% · ${c.audience.evidence.reference}` : 'Audience breakdown unavailable.'}</p>
        {c.historical.median_views.value!=null && <p>Median seven-day views {Number(c.historical.median_views.value).toLocaleString()} · {c.historical.median_views.observations} measured posts.</p>}
        {c.limitations.length>0 && <p>{c.limitations.map(explain).join(' · ')}</p>}
      </details>)}
      {option.suggested_topics.length>0 && <p>Suggested topics · {option.suggested_topics.join(', ')}</p>}
    </div>
  </Panel>;
}

export function ResearchFindings({report}:{report:ResearchReport}) {
  const [view,setView] = useState<'sources'|'strategy'>('sources');
  const first=report.strategies[0];
  const quoted=first?.status==='optimal';
  return <div className="rc-report">
    <section className="rc-decision"><h2>{quoted ? 'Review the quoted allocation' : report.research.examples.length ? 'Shortlist leads for outreach' : 'More evidence is needed'}</h2>
      <p>{quoted && first ? `${first.selected.length} selected at ${amount(first.allocated_minor ?? 0,first.currency)} for your full-budget option.` : report.research.examples.length ? `${report.research.examples.length} source-linked records support discovery. ${first ? statuses[first.status] : 'A quote is needed'} for the requested campaign.` : 'Check the discovery focus, then request the missing evidence for your brief.'}</p>
      {report.next_steps.length>0 && <ul>{report.next_steps.map(text=><li key={text}>{text}</li>)}</ul>}
    </section>
    <div className="rc-switch" aria-label="Report section"><button aria-pressed={view==='sources'} onClick={()=>setView('sources')}>Source evidence <span>{report.research.examples.length}</span></button><button aria-pressed={view==='strategy'} onClick={()=>setView('strategy')}>Compare strategies <span>{report.strategies.length}</span></button></div>
    {view==='sources' ? <EvidenceList report={report}/> : <Options report={report}/>}
    <p className="rc-footnote">{report.outcome_basis} Last analyzed {date(report.analyzed_at)}.</p>
  </div>;
}
