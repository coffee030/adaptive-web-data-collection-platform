import { useCatalogRevision } from './CatalogUpdates';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { eligibility, eligible, fee, audience, planStatus, type Brief, type Creator } from './contracts';
import { useResource } from '../../lib/useResource';
import { ConnectedReport } from './ConnectedReport';
import { briefOptions, deliverableOptions, languageOptions, platformOptions, type DataMode, type Platform } from './intelligence';
import { Evidence, Identity, Overlay, SaveCreator } from './components';
import { useMarketing } from './workspace';

function ReviewedCriteria({ label, name, choices, initial }: { label: string; name: string; choices: string[]; initial?: string }) {
  const [chosen, setChosen] = useState(() => initial?.split(',').map(value => value.trim()).filter(Boolean) ?? []);
  return <div className="hl-span">
    <label>{label}<select aria-label={label} value="" disabled={chosen.length >= 10 || !choices.some(value => !chosen.includes(value))}
      onChange={event => setChosen([...chosen, event.target.value])}>
      <option value="">Choose a reviewed criterion</option>
      {choices.filter(value => !chosen.includes(value)).map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
    </select></label>
    <input type="hidden" name={name} value={chosen.join(',')} />
    {chosen.length > 0 && <ul className="hl-criteria">{chosen.map(value => <li key={value}>
      <span>{value.replaceAll('_', ' ')}</span>
      <button type="button" aria-label={'Remove ' + value.replaceAll('_', ' ') + ' from ' + label.toLowerCase()}
        onClick={() => setChosen(chosen.filter(item => item !== value))}>Remove</button>
    </li>)}</ul>}
  </div>;
}

function BriefForm({ initial, onSave, onCancel, mode }: { initial: Brief; onSave: (brief: Brief) => void; onCancel?: () => void; mode?: DataMode }) {
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState(initial.platform.toLowerCase() as Platform);
  const loadOptions = useCallback((signal: AbortSignal) => briefOptions(mode!, platform, signal), [mode, platform]);
  const options = useResource(loadOptions, useCatalogRevision(), false, Boolean(mode && platform));
  const available = options.result.state === 'ready' ? options.result.data : undefined;
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
      requiredFacts: read('requiredFacts'), preferredFacts: read('preferredFacts'), categoryLabels: read('categoryLabels'),
    });
  }
  return <form className="hl-brief-form" onSubmit={submit}>
    {error && <p role="alert" className="hl-decision hl-warning">{error}</p>}
    <label>Campaign name<input name="name" required maxLength={80} defaultValue={initial.name} /></label>
    <label>Describe the campaign<textarea name="description" required maxLength={1000} rows={4} defaultValue={initial.description} /></label>
    <fieldset><legend>Mandatory requirements</legend><div className="hl-form-grid">
      <label>Creator budget (HK$)<input name="budget" type="number" min={0} max={10000000} required defaultValue={initial.budget} /></label>
      <label>Required creators<input name="creatorCount" type="number" min={1} max={mode ? 8 : 10} required defaultValue={initial.creatorCount} /></label>
      {mode && <>
        <label>Campaign platform<select key="connected-platform" name="platform" required value={platform} onChange={event => setPlatform(event.target.value as Platform)}><option value="">Choose a platform</option>{Object.entries(platformOptions).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>Campaign deliverable<select name="deliverable" required defaultValue={initial.deliverable}><option value="">Choose a deliverable</option>{Object.entries(deliverableOptions).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      </>}
      {mode && platform && <div className="hl-span hl-note" role="status">
        {available ? (available.quoted_deliverables.length
          ? 'Current HKD quotes cover ' + available.quoted_deliverables.map(value => deliverableOptions[value].toLowerCase()).join(', ') + '.'
          : 'This platform has no current firm HKD quotes.')
          : options.result.state === 'error' ? <>Quote coverage and reviewed criteria are unavailable. <button type="button" onClick={options.retry}>Retry coverage</button></>
          : 'Checking quote coverage and reviewed criteria…'}
      </div>}
      <label>Market<input name="market" maxLength={60} defaultValue={initial.market} /></label>
      <label>Minimum target-market audience (%)<input name="minAudience" type="number" min={0} max={100} required defaultValue={initial.minAudience} /></label>
      {mode ? <label>Campaign language<select name="language" defaultValue={initial.language === 'Cantonese' ? 'yue' : initial.language}>
        <option value="">Any language</option>{Object.entries(languageOptions).map(([key,value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        : <label>Language requirement<input name="language" maxLength={60} defaultValue={initial.language} /></label>}
      <label className="hl-check hl-span"><input name="requireCantonese" type="checkbox" defaultChecked={initial.requireCantonese} />{mode ? 'Require evidence of the selected language' : 'Require evidence of spoken Cantonese'}</label>
      {mode && <ReviewedCriteria label="Required content evidence" name="requiredFacts" choices={available?.reviewed_facts ?? []} initial={initial.requiredFacts} />}
      <label className="hl-span">{mode ? 'Other must-haves for manual review' : 'Other must-haves'}<textarea name="required" rows={2} maxLength={500} defaultValue={initial.required} /></label>
    </div></fieldset>
    <fieldset><legend>Objective and optional preferences</legend><div className="hl-form-grid">
      {mode ? <>
        <label>Campaign objective<select name="objective" defaultValue={initial.objective === 'Engagement' ? 'Engagement' : 'Local awareness'}><option>Local awareness</option><option>Engagement</option></select></label>
        <ReviewedCriteria label="Preferred content evidence" name="preferredFacts" choices={available?.reviewed_facts ?? []} initial={initial.preferredFacts} />
        <label key="connected-categories" className="hl-span">Your category labels<input name="categoryLabels" maxLength={1090} defaultValue={initial.categoryLabels} placeholder="Separate labels with commas, or leave blank for suggestions" /></label>
      </> : <>
        <label>Campaign objective<input name="objective" maxLength={80} defaultValue={initial.objective} /></label>
        <label>Preferred platform<select key="local-platform" name="platform" defaultValue={initial.platform}><option value="">Any supported platform</option><option>Instagram</option><option>TikTok</option></select></label>
        <label key="draft-deliverable">Preferred deliverable<input name="deliverable" maxLength={80} defaultValue={initial.deliverable} /></label>
      </>}
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

export function Advisor({ capability, mode }: { capability: ReactNode; mode?: DataMode }) {
  const { draft, saveBrief, demo, creators, path, setLines } = useMarketing();
  const [compactBrief, setCompactBrief] = useState(() => matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const query = matchMedia('(max-width: 760px)');
    const resize = () => setCompactBrief(query.matches);
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);
  const { hash } = useLocation();
  const [editing, setEditing] = useState(!draft.saved || hash === '#edit-requirements');
  const [evidence, setEvidence] = useState<Creator>();
  const { brief } = draft;
  const { pick, minimum } = sampleRecommendation(creators, brief);
  const label = pick ? 'Start with ' + pick.group.map(creator => creator.name).join(' and ') + '.'
    : minimum !== null ? 'No feasible combination within budget' : 'No eligible combination with quotes';
  return <div className="hl-advisor">
    <aside className="hl-brief-lane" aria-label="Current campaign brief">
      <div className="hl-crumb">Campaign Advisor</div>
      <h1>{draft.saved ? brief.name : 'Start a campaign'}</h1>
      {mode==='partner' && Boolean(draft.research?.leads.length) && <p><Link to={path('research-plan')}>Open research shortlist ({draft.research!.leads.length})</Link></p>}
      {draft.saved ? <details className="hl-brief-details" key={String(compactBrief)} open={!compactBrief || editing}>
        <summary>Brief and requirements <span>· {fee(brief.budget)}</span></summary>
        <section><div className="hl-row-between"><h2>Campaign brief</h2>{!editing && <button type="button" onClick={() => setEditing(true)}>Edit brief</button>}</div><p>{brief.description}</p></section>
        <section><h2>Mandatory requirements</h2><dl>
          <div><dt>Budget cap</dt><dd>{fee(brief.budget)}</dd></div><div><dt>Creator slots</dt><dd>{brief.creatorCount}</dd></div>
          {mode && <div><dt>Platform</dt><dd>{platformOptions[brief.platform as keyof typeof platformOptions]}</dd></div>}
          {mode && <div><dt>Deliverable</dt><dd>{deliverableOptions[brief.deliverable as keyof typeof deliverableOptions]}</dd></div>}
          {brief.market && (!mode || brief.minAudience > 0) && <div><dt>Market</dt><dd>{brief.market}</dd></div>}
          {brief.minAudience > 0 && <div><dt>Target-market audience</dt><dd>{brief.minAudience}% minimum</dd></div>}
          {brief.language && (!mode || brief.requireCantonese) && <div><dt>Language</dt><dd>{languageOptions[brief.language as keyof typeof languageOptions] ?? brief.language}</dd></div>}
          {brief.requireCantonese && <div><dt>Evidence</dt><dd>{mode ? 'Selected language required' : 'Spoken Cantonese'}</dd></div>}
          {mode && brief.requiredFacts && <div><dt>Reviewed facts</dt><dd>{brief.requiredFacts.replaceAll('_',' ')}</dd></div>}
        </dl>{brief.required && <p>{brief.required}</p>}</section>
        <section><h2>Optional preferences</h2>
          <p>{(mode ? [brief.objective] : [brief.objective, brief.platform, brief.deliverable]).filter(Boolean).join(' · ')}</p>
          {mode && brief.minAudience === 0 && brief.market && <p>Target market · {brief.market}</p>}
          {mode && brief.language && !brief.requireCantonese && <p>Preferred language · {languageOptions[brief.language as keyof typeof languageOptions] ?? brief.language}</p>}
          {mode && brief.preferredFacts && <p>Preferred reviewed facts · {brief.preferredFacts.replaceAll('_',' ')}</p>}
          {brief.preferred && <p>{brief.preferred}</p>}</section>
      </details> : <p>Set the campaign scope and the requirements a creator needs to meet.</p>}
    </aside>
    <div className="hl-report">
      {editing ? <><h2>Campaign brief</h2><BriefForm initial={brief} mode={mode} onSave={value => {
        saveBrief(value); setEditing(false);
      }} onCancel={draft.saved ? () => setEditing(false) : undefined} /></> : <>
        <div className="hl-report-top"><strong>Campaign recommendation</strong><span>{demo || mode === 'demo' ? 'Fictional sample' : 'Live workspace'}</span></div>
        {mode ? <ConnectedReport mode={mode} /> : !demo ? <div className="hl-availability">{capability}<Link className="hl-button" to={path('plan')}>Open draft plan</Link></div> : <>
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