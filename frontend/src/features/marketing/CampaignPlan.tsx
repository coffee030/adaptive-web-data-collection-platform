import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { eligibility, fee, planStatus, type Brief, type Creator, type PlanLine } from './contracts';
import { Identity } from './components';
import { useMarketing } from './workspace';

const csvCell = (value: string | number) => {
  const text = String(value);
  return '"' + (/^\s*[=+@-]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
};

function download(brief: Brief, lines: PlanLine[], creators: readonly Creator[], assumption: string, demo: boolean) {
  const result = planStatus(lines, creators, brief);
  const rows = [
    ['Classification', demo ? 'Fictional demo' : 'Local campaign draft'], ['Campaign', brief.name],
    ['Plan status', result.status], ['Budget cap (HKD)', brief.budget], ['Known spend (HKD)', result.known],
    ['Total creator fees (HKD)', result.missing.length ? 'Unavailable' : result.known], ['Scenario assumption', assumption],
    ['Creator', 'Deliverables', 'Quote per deliverable (HKD)', 'Eligibility'],
    ...lines.map(line => {
      const creator = creators.find(item => item.id === line.creatorId);
      return [creator?.name ?? 'Unavailable creator', line.quantity, line.quote ?? 'Quote missing',
        creator ? eligibility(creator, brief) : 'Unavailable'];
    }),
  ];
  exportCsv(rows, demo ? 'harbourline-fictional-plan.csv' : 'harbourline-draft.csv');
}

export function exportCsv(rows: (string | number)[][], filename: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff', rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CampaignPlan() {
  const { draft, setDraft, demo, creators, path, setLines, saveBrief } = useMarketing();
  const [exported, setExported] = useState(false);
  const brief = draft.brief;
  const result = planStatus(draft.lines, creators, brief);
  const assumptions = draft.assumption ?? '';
  const candidates = creators.filter(creator => draft.shortlist.includes(creator.id) || draft.lines.some(line => line.creatorId === creator.id));

  function changeScope(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = { ...brief, budget: Number(data.get('budget')), creatorCount: Number(data.get('creatorCount')) };
    if (draft.saved) saveBrief(next);
    else setDraft(old => ({ ...old, brief: next }));
  }
  function include(creator: Creator, checked: boolean) {
    setLines(checked ? [...draft.lines, { creatorId: creator.id, quantity: 1, quote: creator.quote }]
      : draft.lines.filter(line => line.creatorId !== creator.id));
  }
  function amend(id: string, field: 'quantity' | 'quote', value: number | null) {
    setLines(draft.lines.map(line => line.creatorId === id ? { ...line, [field]: value } : line));
  }
  return <div className="hl-page hl-plan">
    <div className="hl-crumb">{draft.saved ? brief.name : 'Campaign workspace'}</div>
    <div className="hl-page-heading"><div><h1>Campaign plan</h1><p>Review creator selections, deliverables and quoted costs.</p></div>
      <button className="hl-primary" type="button" disabled={!draft.saved && !draft.lines.length} onClick={() => {
        download(brief, draft.lines, creators, assumptions, demo); setExported(true);
      }}>Export {result.status === 'Feasible within budget' ? 'plan' : 'draft'} CSV</button>
    </div>
    {exported && <p role="status" className="hl-note">CSV exported with the current plan status and quote coverage.</p>}
    <form className="hl-plan-scope" onSubmit={changeScope}>
      <label>Budget cap (HK$)<input name="budget" type="number" required min={0} max={10000000} defaultValue={brief.budget} /></label>
      <label>Required creators<input name="creatorCount" type="number" required min={1} max={10} defaultValue={brief.creatorCount} /></label>
      <button type="submit">Update scope</button>
    </form>
    <section className={`hl-decision ${result.status === 'Feasible within budget' ? '' : 'hl-warning'}`} aria-label="Plan feasibility" aria-live="polite">
      <strong>{result.status}</strong>
      <ul>
        {result.over > 0 && <li>Known fees exceed the cap by {fee(result.over)}.</li>}
        {result.missing.length > 0 && <li>{result.missing.length} {result.missing.length === 1 ? 'quote is' : 'quotes are'} missing. Total spend is unavailable.</li>}
        {!result.scopeMet && <li>{draft.lines.length} of {brief.creatorCount} required creators selected.</li>}
        {result.gaps.length > 0 && <li>Eligibility unresolved for {result.gaps.join(', ')}.</li>}
        {result.manualReview && <li>Review additional mandatory requirements before confirming the plan.</li>}
        {result.status === 'Feasible within budget' && <li>{draft.lines.length} creator selections have eligible evidence and entered quotes.</li>}
      </ul>
    </section>
    <dl className="hl-budget">
      <div><dt>{result.missing.length ? 'Known creator spend' : 'Planned creator spend'}</dt><dd>{fee(result.known)}</dd></div>
      <div><dt>{result.missing.length ? 'Budget balance' : result.over ? 'Over budget' : 'Budget remaining'}</dt>
        <dd>{result.missing.length ? 'Unresolved' : fee(result.over || brief.budget - result.known)}</dd></div>
    </dl>
    <section className="hl-plan-lines"><h2>Creator selections and quotes</h2>
      {candidates.length ? candidates.map(creator => {
        const line = draft.lines.find(item => item.creatorId === creator.id);
        return <div className="hl-plan-line" key={creator.id}>
          <label className="hl-check"><input type="checkbox" checked={Boolean(line)} onChange={event => include(creator,event.target.checked)} />
            <span className="hl-sr">Include {creator.name}</span></label>
          <div><Identity creator={creator} /><p className="hl-row-status">{eligibility(creator, brief)}</p></div>
          {line && <>
            <label>Deliverables<input type="number" aria-label={`Deliverables for ${creator.name}`} min={1} max={50} defaultValue={line.quantity} onBlur={event => {
              const input = event.currentTarget;
              if (input.value && input.checkValidity()) amend(creator.id,'quantity',input.valueAsNumber);
              else input.value = String(line.quantity);
            }} /></label>
            <label>Quote per deliverable (HK$)<input type="number" aria-label={`Quote per deliverable (HK$) for ${creator.name}`} min={0} max={10000000}
              placeholder="Enter quote" defaultValue={line.quote ?? ''} onBlur={event => {
                const input = event.currentTarget;
                if (!input.value) amend(creator.id,'quote',null);
                else if (input.checkValidity()) amend(creator.id,'quote',input.valueAsNumber);
                else input.value = String(line.quote ?? '');
              }} />{line.quote === null && <small>Quote missing</small>}</label>
          </>}
        </div>;
      }) : <div className="hl-empty"><p>{demo ? 'Shortlist creators to bring them into the draft.' : 'Eligible creator selections and quotes will appear when live recommendations are available.'}</p>
        <Link className="hl-button" to={path('creators')}>Open Creator Explorer</Link></div>}
    </section>
    <section className="hl-scenario"><h2>Planning assumptions</h2><p>Record assumptions to include in the draft export. Campaign outcomes and ROI forecasting are deferred.</p>
      <label>Scenario assumptions<textarea maxLength={800} rows={3} value={assumptions} onChange={event => {
        const value = event.target.value; setDraft(old => ({ ...old, assumption: value }));
      }} placeholder="For example, fees exclude paid media and production." /></label>
    </section>
  </div>;
}