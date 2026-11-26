import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { TableRegion } from '../../components/feedback';
import { useMarketing } from './workspace';
import { useResearch } from './ResearchBrief';
import { publicPath, revisionUrl, usePublicResults, type Directory, type Works } from './publicResearch';
import { apiGet } from '../../lib/api';
import { SourceLink } from './PublishedWorks';
import { exportCsv } from './CampaignPlan';

const question='Request recent relevant posts, a platform-specific audience report and a dated HKD quote covering the deliverable, usage rights and validity period.';
type Lead = {id:string; name:string; evidence:string; platform:string; source:string; date:string; attribution:string; license:string; textLicense:string; original?:string|null; excerpt?:string; localExcerpt?:string; visualText?:string; reading?:string; checksum?:string; views?:number; viewMonth?:string; metricSource?:string; metricLicense?:string};
function resolveLeads(ids:string[],directory?:Directory,works?:Works,pinned?:Record<string,string[]>) {
  return ids.map(id=>{
    const person=works?.state==='available' ? works.contributors.find(c=>'commons:'+c.id===id) : undefined;
    const profile=directory?.state==='available' ? directory.profiles.find(p=>'wikidata:'+p.item===id) : undefined;
    const items:Lead[] = person ? person.matched_works.filter(w=>!pinned?.[id] || pinned[id]!.includes(w.id)).map(w=>({id,name:person.name,evidence:w.title,platform:w.platform,source:w.revision_url,date:w.date,attribution:person.name,license:w.license_url,textLicense:w.text_license_url,original:w.original_url,excerpt:w.excerpt,localExcerpt:w.local_excerpt,visualText:w.visual_evidence?.source_text,reading:w.visual_evidence?.interpretation,checksum:w.visual_evidence?.image_sha1,views:w.pageviews?.count,viewMonth:w.pageviews?.month,metricSource:w.pageviews?.source_url,metricLicense:w.pageviews?.license_url})) :
      profile ? [{id,name:profile.name,evidence:profile.description,platform:'Wikidata identity',source:revisionUrl(profile),date:directory!.observed?.slice(0,10)??'',attribution:'Wikidata contributors',license:'https://creativecommons.org/publicdomain/zero/1.0/',textLicense:'https://creativecommons.org/publicdomain/zero/1.0/'}] : [];
    return {id,items};
  });
}
export function ResearchPlan({isolated}:{isolated:boolean}) {
  const {path,company,campaignReceipt,draft,saveBrief}=useMarketing();
  const navigate=useNavigate();
  const {brief,update,toggle}=useResearch();
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [edited,setEdited]=useState(false);
  const dirPath=publicPath(isolated,'directory');
  const workPath=publicPath(isolated,'works');
  const directory=usePublicResults<Directory>(dirPath);
  const works=usePublicResults<Works>(workPath);
  const people=resolveLeads(brief.leads,directory.result.state==='ready'?directory.result.data:undefined,works.result.state==='ready'?works.result.data:undefined,brief.works);
  const pending=directory.result.state==='loading'||works.result.state==='loading';
  const ready=people.filter(p=>p.items.length);
  function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const fields=new FormData(event.currentTarget);
    const budget=String(fields.get('budget')??'');
    update(old=>({...old,title:String(fields.get('title')??'').trim(),objective:String(fields.get('objective')??'').trim(),
      budget:budget===''?null:Number(budget),deliverable:String(fields.get('deliverable')??'').trim()}));
    setEdited(false);setNotice(company?'Brief updated.':'Brief saved in this browser.');
  }
  async function download() {
    setBusy(true);setNotice('');
    try {
      const signal=AbortSignal.timeout(12000);
      const hasW=brief.leads.some(id=>id.startsWith('commons:')),hasD=brief.leads.some(id=>id.startsWith('wikidata:'));
      const [d,w]=await Promise.all([hasD?apiGet<Directory>(dirPath,signal):undefined,hasW?apiGet<Works>(workPath,signal):undefined]);
      const live=resolveLeads(brief.leads,d,w,brief.works);
      const rows:(string|number)[][]=[['Classification','Public creator research brief'],['Campaign',brief.title],['Objective',brief.objective],['Requested deliverable',brief.deliverable],['Planning budget (HKD)',brief.budget??'Unspecified'],['Confirmed creator fees','Unknown'],['Booking feasibility','Awaiting current firm quotes'],['Evidence to request',question],[],['Contributor','Documented evidence','Publication source','Work or observation date','Revision URL','Attribution','License','Description license','Original publication','Commons file-page views','Month','Metric source','Metric license','Description excerpt (formatted or shortened)','Local description excerpt','Text transcribed from photograph','Interpretation of photographed text','Photograph SHA-1']];
      for(const {id,items} of live) {
        if(!items.length) rows.push([id,'Current public evidence unavailable']);
        for(const item of items) rows.push([item.name,item.evidence,item.platform,item.date,item.source,item.attribution,item.license,item.textLicense,item.original??'',item.views??'Unavailable',item.viewMonth??'',item.metricSource??'',item.metricLicense??'',item.excerpt??'',item.localExcerpt??'',item.visualText??'',item.reading??'',item.checksum??'']);
      }
      exportCsv(rows,'harbourline-research-brief.csv');setNotice('Research brief exported.');
    } catch {setNotice('Current evidence could not be verified. Check the connection and export again.');}
    finally {setBusy(false);}
  }
  return <div className="hl-page hl-research-plan"><header className="hl-page-heading"><div><h1>Research shortlist</h1><p>{company?'Saved with the active company campaign.':'Saved in this browser on this workstation.'} Prepare a brief before requesting rates.</p></div></header>
    <div className="hl-research-columns"><section><div className="hl-section-bar"><h2>Selected leads <span>{brief.leads.length}</span></h2><Link to={path('directory')}>Find creators →</Link></div>
    {!people.length && <div className="hl-evidence-notice"><strong>Your shortlist is empty.</strong><p>Save contributors from their published works or a source-linked identity record.</p></div>}
    {(directory.result.state==='error'||works.result.state==='error') && <p role="alert">Some sources could not be checked. <button onClick={()=>{directory.retry();works.retry();}}>Retry source checks</button></p>}
    {people.map(({id,items})=><article className="hl-shortlisted-lead" key={id}><div className="hl-row-between"><h3>{items[0]?.name??(pending?'Checking source…':'Evidence unavailable')}</h3><button onClick={()=>toggle(id)} aria-label={'Remove '+(items[0]?.name??id)}>Remove</button></div>
      {items.length>0 && <><p>{items[0]!.evidence}</p>{(items[0]!.reading || items[0]!.excerpt) && <p className="hl-result-excerpt">{items[0]!.reading || items[0]!.excerpt}</p>}<small>{items.length} {items.length===1?'source record':'source records'} · {Array.from(new Set(items.map(w=>w.platform))).join(' / ')}</small> <SourceLink url={items[0]!.source}>Source revision ↗</SourceLink>
      {items[0]!.excerpt && <details className="hl-collected-source"><summary>Inspect saved work and attribution</summary>
        {items.map(item=><section key={item.source}><h4>{item.date} · {item.platform}</h4>
          <p>{item.reading || item.excerpt}</p><small>{item.attribution} · <SourceLink url={item.source}>Source revision</SourceLink> · <SourceLink url={item.textLicense}>Description license</SourceLink></small>
        </section>)}</details>}</>}</article>)}
      {ready.length>=2 && <section className="hl-source-comparison"><h2>Compare documented work</h2><TableRegion label="Public research comparison"><table><thead><tr><th>Contributor</th><th>Records</th><th>Platform or source</th><th>Documented dates</th></tr></thead><tbody>{ready.map(({id,items})=>{
        const dates=items.map(w=>w.date.slice(0,4)).filter(Boolean).sort();
        return <tr key={id}><th scope="row">{items[0]!.name}</th><td>{items.length}</td><td>{[...new Set(items.map(w=>w.platform))].join(', ')}</td><td>{[...new Set([dates[0],dates.at(-1)])].join('–')}</td></tr>;
      })}</tbody></table></TableRegion><p>Counts cover the collected sources. Platform reach, audience overlap and booking rates require separate evidence.</p></section>}
      {!!people.length && <section className="hl-next-proof"><h2>What to request</h2><p>{question}</p><strong>Booking feasibility · Awaiting quotes</strong></section>}
    </section><aside className="hl-request-brief"><h2>Evidence request brief</h2>
      <form key={JSON.stringify([brief.title,brief.deliverable,brief.objective,brief.budget])} onChange={()=>{setEdited(true);setNotice('');}} onSubmit={save}>
        <label>Campaign name<input name="title" required maxLength={160} defaultValue={brief.title} placeholder="e.g. Neighbourhood lunch launch"/></label>
        <label>Campaign objective<textarea name="objective" maxLength={1000} rows={3} defaultValue={brief.objective} placeholder="Who do you need to reach?"/></label>
        <label>Requested deliverable<input name="deliverable" maxLength={160} defaultValue={brief.deliverable} placeholder="e.g. A Cantonese short video"/></label>
        <label>Planning budget (HK$)<input type="number" name="budget" min={0} max={10000000} step={1} defaultValue={brief.budget??''} placeholder="Optional"/></label>
        <button className="hl-primary">Save research brief</button>
      </form>
      {edited && <p role="status">Save your changes before exporting.</p>}
      <button disabled={!brief.leads.length||busy||edited||campaignReceipt?.pending} onClick={download}>{busy?'Checking current sources…':'Export research brief CSV'}</button>
      {notice && <p role="status">{notice}</p>}
      {company && <><p>Campaign Advisor checks your company’s eligible content and firm quotes. Public leads remain available in this research shortlist.</p>
        {brief.title && !draft.saved ? <button disabled={campaignReceipt?.pending} onClick={()=>{
          saveBrief({...draft.brief,name:brief.title,description:brief.objective||brief.title,budget:brief.budget??draft.brief.budget,
            required:[draft.brief.required,brief.deliverable && 'Requested deliverable · '+brief.deliverable].filter(Boolean).join('\n')});
          navigate(path('advisor')+'#edit-requirements');
        }}>Use saved research brief in Advisor</button> : <Link to={path('advisor')}>Open company Campaign Advisor →</Link>}</>}
    </aside></div>
  </div>;
}