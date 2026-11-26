import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Card } from '../../components/tremor/Card';
import { ProgressCircle } from '../../components/tremor/ProgressCircle';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRoot, TableRow } from '../../components/tremor/Table';
import { useResource } from '../../lib/useResource';
import { useCatalogRevision } from './CatalogUpdates';
import { catalog, platformOptions, visibleFor, type DataMode } from './intelligence';
import { IntelligenceError, Pending, RefreshOnFocus } from './IntelligenceEvidence';
import { useMarketing } from './workspace';

interface ResearchRow { id: string; name: string; detail: string; posts: number; quoted: boolean; audience: boolean; portrait?: string }
interface Week { start: string; posts: number }
const shortDate = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', {day:'numeric',month:'short',timeZone:'UTC'});

function CoverageChart({ rows }: { rows: ResearchRow[] }) {
  const quotes = rows.filter(row=>row.quoted).length;
  return <Card className="hl-chart-card"><h2>Quote coverage</h2><p>Creators with a current firm quote</p>
    <div className="hl-quote-ring"><ProgressCircle radius={74} strokeWidth={13} value={quotes} max={Math.max(1,rows.length)} showAnimation={false} aria-label="Creators with a current firm quote">
      <div><strong>{rows.length ? Math.round(100*quotes/rows.length)+'%' : '—'}</strong><small>quoted</small></div>
    </ProgressCircle></div>
    <dl className="hl-legend"><div><dt>Current quote</dt><dd>{quotes}</dd></div><div><dt>Quote unavailable</dt><dd>{rows.length-quotes}</dd></div></dl>
  </Card>;
}

function ContentChart({ rows, activity }: { rows: ResearchRow[]; activity?: Week[] }) {
  const [view,setView] = useState('creators');
  const { path } = useMarketing();
  const top = [...rows].sort((a,b)=>b.posts-a.posts || a.name.localeCompare(b.name)).slice(0,6);
  const max = Math.max(1,...top.map(row=>row.posts));
  const weeklyMax = Math.max(1,...(activity ?? []).map(week=>week.posts));
  return <Card className="hl-chart-card"><div className="hl-row-between"><div><h2>Content coverage</h2><p>{view==='creators' ? 'Creators with the most historical posts' : 'Posts published in the last 12 calendar weeks · UTC'}</p></div>
    {activity && <select aria-label="Content coverage view" value={view} onChange={e=>setView(e.target.value)}><option value="creators">By creator</option><option value="weeks">By week</option></select>}</div>
    {!rows.length ? <p className="hl-empty-plot">Activity appears when creator content is available.</p> : view==='creators' ? <ol className="hl-bar-list">{top.map(row=><li key={row.id}><Link to={path('creators')+'?creator='+encodeURIComponent(row.id)}>
      <span className="hl-bar-track" style={{width:(100*row.posts/max)+'%'}}/><span>{row.name}</span><b>{row.posts}</b></Link></li>)}</ol>
    : <div className="hl-weekly">{activity?.map(week=><div key={week.start} title={shortDate(week.start)+' · '+week.posts+' posts'}><strong>{week.posts}</strong><i style={{height:(105*week.posts/weeklyMax)+'px'}}/><small>{shortDate(week.start)}</small></div>)}</div>}
  </Card>;
}

function CatalogAnalytics({rows,activity}:{rows:ResearchRow[];activity?:Week[]}) {
  const {draft, path} = useMarketing();
  const [slice,setSlice] = useState('all');
  const visible = rows.filter(row=>slice==='all'||(slice==='quoted'?row.quoted:draft.shortlist.includes(row.id)));
  const metrics = [['Researchable creators',rows.length],['Historical posts',rows.reduce((n,r)=>n+r.posts,0)],['With audience data',rows.filter(r=>r.audience).length],['Campaign shortlist',rows.filter(r=>draft.shortlist.includes(r.id)).length]] as const;
  return <><dl className="hl-kpis">{metrics.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value.toLocaleString('en-HK')}</dd></div>)}</dl>
    <div className="hl-charts"><ContentChart rows={rows} activity={activity}/><CoverageChart rows={rows}/></div>
    <section className="hl-roster"><div className="hl-row-between"><div><h2>Creator directory</h2><p>Open a creator to review their content and rates.</p></div><Link to={path('creators')}>Explore creators <span aria-hidden="true">→</span></Link></div>
      <div className="hl-slices">{[['all','All creators'],['quoted','With quotes'],['shortlist','Shortlisted']].map(([key,label])=><button key={key} aria-pressed={slice===key} onClick={()=>setSlice(key!)}>{label}</button>)}</div>
      {visible.length ? <TableRoot><Table><TableHead><TableRow>{['Creator','Historical posts','Quote','Audience evidence'].map(x=><TableHeaderCell key={x}>{x}</TableHeaderCell>)}</TableRow></TableHead><TableBody>{visible.slice(0,6).map(row=><TableRow key={row.id}>
        <TableCell><Link className="hl-person-link" to={path('creators')+'?creator='+encodeURIComponent(row.id)}>{row.portrait ? <img width="34" height="34" src={row.portrait} alt=""/> : <span aria-hidden="true" className="hl-initial">{row.name.replace(/^Fixture /,'').split(/\s+/u).slice(0,2).map(word=>word[0]).join('')}</span>}<span>{row.name}<small>{row.detail}</small></span></Link></TableCell>
        <TableCell>{row.posts}</TableCell><TableCell>{row.quoted ? 'Available' : 'Unavailable'}</TableCell><TableCell>{row.audience?'Available':'Unavailable'}</TableCell></TableRow>)}</TableBody></Table></TableRoot>
      : <p className="hl-empty">{slice==='shortlist'?'Shortlist a creator from their research profile.':'No creators match this view.'}</p>}
      {visible.length>6 && <p className="hl-note">Showing 6 of {visible.length} creators</p>}</section></>;
}

export function OverviewAnalytics({mode}:{mode?:DataMode}) {
  const {demo,creators,path}=useMarketing();
  const load=useCallback((signal:AbortSignal)=>catalog(mode!,new URLSearchParams(),signal),[mode]);
  const request=useResource(load,useCatalogRevision(),false,Boolean(mode));
  if(demo) return <CatalogAnalytics rows={creators.map(c=>({id:c.id,name:c.name,detail:c.handle,posts:c.sample,quoted:c.quote!==null,audience:c.hk!==null&&!c.expired,portrait:c.portrait}))}/>;
  if(!mode)return null;
  if(request.result.state==='loading')return <Pending>Loading creator coverage…</Pending>;
  if(request.result.state==='error')return <IntelligenceError error={request.result.error} retry={request.retry}/>;
  if (mode === 'partner' && request.result.data.state === 'empty') return <section className="hl-decision">
    <h2>Start with the public directory</h2><p>Research Hong Kong creators and inspect their sources. Private campaign analysis becomes available when your company has approved content and rates.</p>
    <Link to={path('directory')}>Explore public creators →</Link><RefreshOnFocus refresh={request.retry}/>
  </section>;
  return <><RefreshOnFocus refresh={request.retry}/><CatalogAnalytics activity={request.result.data.activity} rows={request.result.data.creators.filter(c=>visibleFor(mode,c.profile.evidence)).map(c=>({
    id:c.profile.data.creator_id,name:c.profile.data.name,detail:c.profile.data.accounts.map(a=>platformOptions[a.platform]).join(' · '),posts:c.post_count,quoted:c.pricing==='available',audience:c.audience==='available'
  }))}/></>;
}
