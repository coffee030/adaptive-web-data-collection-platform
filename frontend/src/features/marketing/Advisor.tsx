import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { eligibility, eligible, fee, audience, planStatus, type Brief, type Creator } from './contracts';
import { Evidence, Identity, Overlay, SaveCreator } from './components';
import { useMarketing } from './workspace';

function BriefForm({ initial, onSave, onCancel }: { initial: Brief; onSave: (brief: Brief) => void; onCancel?: () => void }) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (key: string) => String(data.get(key) ?? '').trim();
    const name = read('name');
    const description = read('description');
    if (!name || !description) {
      setError('Enter a campaign name and describe the campaign.');
      return;
    }
    onSave({ name, description, budget: Number(read('budget')), objective: read('objective'),
      market: read('market'), language: read('language'), platform: read('platform'), deliverable: read('deliverable'),
      minAudience: Number(read('minAudience')), creatorCount: Number(read('creatorCount')),
      requireCantonese: data.has('requireCantonese'), required: read('required'), preferred: read('preferred'),
    });
  }
  return <form className="hl-brief-form" onSubmit={submit}>
    {error && <p role="alert" className="hl-decision hl-warning">{error}</p>}
    <label>Campaign name<input name="name" required maxLength={80} defaultValue={initial.name} /></label>
    <label>Describe the campaign<textarea name="description" required maxLength={1000} rows={4} defaultValue={initial.description} /></label>
    <fieldset><legend>Mandatory requirements</legend><div className="hl-form-grid">
      <label>Creator budget (HK$)<input name="budget" type="number" min={0} max={10000000} required defaultValue={initial.budget} /></label>
      <label>Required creators<input name="creatorCount" type="number" min={1} max={10} required defaultValue={initial.creatorCount} /></label>
      <label>Market<input name="market" maxLength={60} defaultValue={initial.market} /></label>
      <label>Minimum HK audience (%)<input name="minAudience" type="number" min={0} max={100} required defaultValue={initial.minAudience} /></label>
      <label>Language requirement<input name="language" maxLength={60} defaultValue={initial.language} /></label>
      <label className="hl-check hl-span"><input name="requireCantonese" type="checkbox" defaultChecked={initial.requireCantonese} />Require evidence of spoken Cantonese</label>
      <label className="hl-span">Other must-haves<textarea name="required" rows={2} maxLength={500} defaultValue={initial.required} /></label>
    </div></fieldset>
    <fieldset><legend>Objective and optional preferences</legend><div className="hl-form-grid">
      <label>Campaign objective<input name="objective" maxLength={80} defaultValue={initial.objective} /></label>
      <label>Preferred platform <select name="platform" defaultValue={initial.platform}><option value="">Any supported platform</option><option>Instagram</option><option>TikTok</option></select></label>
      <label>Preferred deliverable<input name="deliverable" maxLength={80} defaultValue={initial.deliverable} /></label>
      <label className="hl-span">Optional preferences<textarea name="preferred" rows={2} maxLength={500} defaultValue={initial.preferred} /></label>
    </div></fieldset>
    <div className="hl-actions">{onCancel && <button type="button" onClick={onCancel}>Cancel</button>}<button className="hl-primary" type="submit">Save brief</button></div>
  </form>;
}

function sampleRecommendation(creators: readonly Creator[], brief: Brief) {
  const priced = creators.filter(creator => eligible(creator, brief) && creator.quote !== null);
  const combinations: Creator[][] = [[]];
  for (const creator of priced) {
    combinations.push(...combinations.filter(group => group.length < brief.creatorCount).map(group => [...group, creator]));
  }
  const choices = combinations.filter(group => group.length === brief.creatorCount)
    .map(group => ({ group, cost: group.reduce((total, creator) => total + (creator.quote ?? 0), 0) }));
  const pick = choices.find(choice => choice.cost <= brief.budget);
  return { pick, minimum: choices.length ? Math.min(...choices.map(choice => choice.cost)) : null };
}

export function Advisor({ capability }: { capability: ReactNode }) {
  const { draft, saveBrief, demo, creators, path, setLines } = useMarketing();
  const [compactBrief, setCompactBrief] = useState(() => matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width: 760px)');
    const resize = () => setCompactBrief(query.matches);
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);
  const [editing, setEditing] = useState(!draft.saved);
  const [evidence, setEvidence] = useState<Creator>();
  const { brief } = draft;
  const { pick, minimum } = sampleRecommendation(creators, brief);
  const label = pick ? 'Start with ' + pick.group.map(creator => creator.name).join(' and ') + '.'
    : minimum !== null ? 'No feasible combination within budget' : 'No eligible combination with quotes';
  return <div className="hl-advisor">
    <aside className="hl-brief-lane" aria-label="Current campaign brief">
      <div className="hl-crumb">Campaign Advisor</div>
      <h1>{draft.saved ? brief.name : 'Start a campaign'}</h1>
      {draft.saved ? <details className="hl-brief-details" key={String(compactBrief)} open={!compactBrief || editing}>
        <summary>Brief and requirements <span>· {fee(brief.budget)}</span></summary>
        <section><div className="hl-row-between"><h2>Campaign brief</h2>{!editing && <button type="button" onClick={() => setEditing(true)}>Edit brief</button>}</div><p>{brief.description}</p></section>
        <section><h2>Mandatory requirements</h2><dl>
          <div><dt>Budget cap</dt><dd>{fee(brief.budget)}</dd></div><div><dt>Creator slots</dt><dd>{brief.creatorCount}</dd></div>
          {brief.market && <div><dt>Market</dt><dd>{brief.market}</dd></div>}
          {brief.minAudience > 0 && <div><dt>HK audience</dt><dd>{brief.minAudience}% minimum</dd></div>}
          {brief.language && <div><dt>Language</dt><dd>{brief.language}</dd></div>}
          {brief.requireCantonese && <div><dt>Evidence</dt><dd>Spoken Cantonese</dd></div>}
        </dl>{brief.required && <p>{brief.required}</p>}</section>
        <section><h2>Optional preferences</h2>
          <p>{[brief.objective, brief.platform, brief.deliverable].filter(Boolean).join(' · ')}</p>
          {brief.preferred && <p>{brief.preferred}</p>}</section>
      </details> : <p>Set the campaign scope and the requirements a creator needs to meet.</p>}
    </aside>
    <div className="hl-report">
      {editing ? <><h2>Campaign brief</h2><BriefForm initial={brief} onSave={value => {
        saveBrief(value); setEditing(false);
      }} onCancel={draft.saved ? () => setEditing(false) : undefined} /></> : <>
        <div className="hl-report-top"><strong>Campaign recommendation</strong><span>{demo ? 'Fictional sample' : 'Live workspace'}</span></div>
        {!demo ? <div className="hl-availability">{capability}<Link className="hl-button" to={path('plan')}>Open draft plan</Link></div> : <>
          <h2 className="hl-editorial">{label}</h2>
          {pick ? <>
            <p>{brief.platform === 'TikTok' && 'TikTok coverage is unavailable in this fictional Instagram dataset. '}Ranked by historical content fit in this sample. {planStatus(pick.group.map(c => ({ creatorId: c.id, quantity: 1, quote: c.quote })), creators, brief).manualReview
              ? 'Additional requirements need manual review.' : 'Selected creators meet the checked requirements.'}</p>
            <div className="hl-rec-list">{pick.group.map(creator => <article key={creator.id} className="hl-rec">
              <Identity creator={creator} /><p className="hl-rec-metric"><strong>{audience(creator.hk)}</strong> HK audience</p>
              <div><strong>{creator.post.title}</strong><p>{creator.reason}</p></div>
              <div className="hl-actions"><button type="button" onClick={() => setEvidence(creator)}>Evidence for {creator.name}</button><SaveCreator creator={creator} /></div>
            </article>)}</div>
            <div className="hl-row-between hl-total"><p><strong>{fee(pick.cost)}</strong> for one sample Reel each · {fee(brief.budget - pick.cost)} of budget left</p>
              <Link className="hl-button hl-primary" to={path('plan')} onClick={() => {
                if (!draft.lines.length) setLines(pick.group.map(creator => ({ creatorId: creator.id, quantity: 1, quote: creator.quote })));
              }}>Inspect plan</Link>
              {draft.lines.length > 0 && <button type="button" onClick={() => setLines(pick.group.map(creator => ({
                creatorId: creator.id, quantity: 1, quote: creator.quote,
              })))}>Apply sample combination to draft</button>}
            </div>
          </> : <p>{minimum !== null ? `The lowest eligible sample combination costs ${fee(minimum)}. The cap is ${fee(brief.budget)}.`
            : 'Review the requirements and available sample quotes.'}</p>}
          <section className="hl-candidate-strip" aria-labelledby="hl-candidates"><h3 id="hl-candidates">Creator screening</h3>
            {creators.map(creator => <div key={creator.id}><Link to={`${path('creators')}?creator=${creator.id}`}>{creator.name}</Link>
              <span>{eligibility(creator, brief)}{creator.quote === null && ' · Quote missing'}{creator.expired && ' · Older snapshot'}</span></div>)}
          </section>
          <Link className="hl-button" to={path('creators')}>Open Creator Explorer</Link>
        </>}
      </>}
      {evidence && <Overlay title={`Evidence for ${evidence.name}`} close={() => setEvidence(undefined)}><Evidence creator={evidence} /></Overlay>}
    </div>
  </div>;
}