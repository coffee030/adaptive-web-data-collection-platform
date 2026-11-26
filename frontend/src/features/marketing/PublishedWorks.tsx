import { Link, useSearchParams } from 'react-router';
import { useMarketing } from './workspace';
import { SaveResearchLead, useResearch } from './ResearchBrief';
import { publicPath, usePublicResults, type Contributor, type PublishedWork, type Works } from './publicResearch';

export function SourceLink({url,children}:{url:string|null|undefined;children:React.ReactNode}) {
  return url && /^https:\/\//i.test(url) ? <a href={url} target="_blank" rel="noreferrer">{children}</a> : null;
}
function thumbnail(work?:PublishedWork) {
  const url=work?.thumbnail_url;
  return url && /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(url) ? url : undefined;
}
export function WorkEvidence({work,author}:{work:PublishedWork;author:string}) {
  return <section className="hl-work-source"><h3>{work.title}</h3>
    {thumbnail(work) && <figure className="hl-source-figure"><img src={thumbnail(work)} alt={work.title} loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true;}}/><figcaption>{author} · <SourceLink url={work.license_url}>{work.license}</SourceLink> · <SourceLink url={work.archive_url}>Photo source</SourceLink></figcaption></figure>}
    <p className="hl-source-meta">Work dated {work.date} · {author} · {work.platform}</p>
    <blockquote lang={work.excerpt_language || undefined}>{work.excerpt}</blockquote>
    {work.local_excerpt && work.local_excerpt!==work.excerpt && <p lang={work.local_language}>{work.local_excerpt}</p>}
    {work.visual_evidence && <section className="hl-menu-reading"><h4>Text visible in the photograph</h4>
      <blockquote>{work.visual_evidence.source_text}</blockquote><p>{work.visual_evidence.interpretation}</p>
      <small>{work.visual_evidence.source_language} · Transcribed from the <SourceLink url={work.revision_url}>archived photograph</SourceLink>.</small>
    </section>}
    {work.pageviews && <p>{work.pageviews.count.toLocaleString('en-HK')} views of this Commons file page · {work.pageviews.month} · <SourceLink url={work.pageviews.source_url}>View measurement</SourceLink></p>}
    <div className="hl-source-links"><SourceLink url={work.revision_url}>Source revision ↗</SourceLink>
      {work.original_url && work.original_url!==work.archive_url && <SourceLink url={work.original_url}>Original publication ↗</SourceLink>}
      <SourceLink url={work.license_url}>{work.license}</SourceLink><SourceLink url={work.text_license_url}>Description license</SourceLink></div>
  </section>;
}
export function PublishedWorks({isolated,query,preview=false}:{isolated:boolean;query:string;preview?:boolean}) {
  const {path}=useMarketing();
  const {brief}=useResearch();
  const [params,setParams]=useSearchParams();
  const {result,retry}=usePublicResults<Works>(publicPath(isolated,'works',query));
  if(result.state==='loading') return <p role="status">Searching published works…</p>;
  if(result.state==='error') return <div className="hl-evidence-notice" role="alert">Published works could not be checked. <button onClick={retry}>Check again</button></div>;
  if(result.data.state!=='available') return <p className="hl-evidence-notice">Published works are {result.data.state==='expired'?'awaiting a source refresh':'currently unavailable'}. Explore public identity records below.</p>;
  const all=result.data.contributors;
  const contributors=preview?all.slice(0,3):all;
  const selected = params.get('contributor');
  const href=(id:string)=>path('directory')+'?'+new URLSearchParams({q:query,contributor:id});
  function change(id:string) {
    const next=new URLSearchParams(params);
    if(selected===id) next.delete('contributor');else next.set('contributor',id);
    setParams(next,{preventScrollReset:true});
  }
  function meta(creator:Contributor) {
    const platforms=[...new Set(creator.matched_works.map(w=>w.platform))];
    return platforms.join(' · ');
  }
  return <section className="hl-published" aria-label="Published work results">
    <header className="hl-section-bar"><div><h2>{preview?'Research leads':'Published work matches'}</h2><p>{preview?'Historical sources for the suggested search.':all.length+' credited contributors'+(query?' for “'+query+'”':'')}</p></div>
      {preview ? <Link to={path('directory')+'?'+new URLSearchParams({q:query})}>View results →</Link> : brief.leads.length>0 && <Link to={path('research-plan')}>Open research shortlist ({brief.leads.length}) →</Link>}</header>
    {!preview && result.data.criteria && <p className="hl-note">{result.data.criteria}</p>}
    {!all.length && <div className="hl-evidence-notice"><strong>No published work matched this search.</strong><p>Try a place, dish or contributor name. Public identity records can help you find someone to investigate.</p>
      {/(茶餐廳|cha chaan teng)/i.test(query) && <Link to={path('directory')+'?q='+encodeURIComponent('茶餐廳')}>Find tea restaurant works without a price filter →</Link>}
      <Link to={path('directory')}>Browse all published works →</Link></div>}
    <ul className="hl-work-list">{contributors.map(person=>{
      const first=person.matched_works[0];
      return <li key={person.id}><div className="hl-work-row">
        <div className="hl-research-avatar" aria-hidden="true">{person.name.slice(0,2).toUpperCase()}{thumbnail(first) && <img alt="" loading="lazy" referrerPolicy="no-referrer" src={thumbnail(first)} onError={e=>{e.currentTarget.hidden=true;}}/>}</div><div className="hl-work-description">
          <h3>{preview ? <Link to={href(person.id)}>{person.name}</Link> : <button type="button" className="hl-text-button" aria-expanded={selected===person.id} onClick={()=>change(person.id)}>{person.name}</button>}</h3>
          <p className="hl-work-excerpt" lang={first?.excerpt_language}>{first?.visual_evidence?.interpretation || first?.excerpt || first?.title}</p>{thumbnail(first) && <small>Photo by {person.name} · <SourceLink url={first?.license_url}>{first?.license}</SourceLink> · <SourceLink url={first?.archive_url}>Source</SourceLink></small>}<small>{first?.date} · {meta(person)} · {person.matched_works.length} {person.matched_works.length===1?'work':'works'}</small>
        </div>{preview ? <Link aria-label={'Inspect work by '+person.name} to={href(person.id)}>Inspect ↗</Link> : <SaveResearchLead name={person.name} id={'commons:'+person.id} workIds={person.matched_works.map(work=>work.id)}/>}</div>
        {!preview && selected===person.id && <div className="hl-work-detail"><p>Historical subject evidence. Creator fees, availability and current audience require separate confirmation.</p>{person.matched_works.map(work=><WorkEvidence key={work.id} work={work} author={person.name}/>)}
          <SourceLink url={person.profile_url}>Contributor profile ↗</SourceLink></div>}
      </li>;
    })}</ul>
  </section>;
}