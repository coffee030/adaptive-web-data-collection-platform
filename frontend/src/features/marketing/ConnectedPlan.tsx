import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useResource } from '../../lib/useResource';
import { HistoricMetrics, IntelligenceError, Pending, QuoteEvidence, measureText } from './IntelligenceEvidence';
import { reportCurrent } from './ConnectedReport';
import { amount, calculateScenario, type CampaignRequest, type DataMode, type ScenarioRequest, runCampaign } from './intelligence';
import { useMarketing } from './workspace';
import { exportCsv } from './CampaignPlan';

function Assumptions({ mode, quoted }: { mode: DataMode; quoted?: number }) {
  const [input, setInput] = useState<ScenarioRequest>();
  const load = useCallback((signal: AbortSignal) => calculateScenario(mode,input!,signal), [mode,input]);
  const { result, retry } = useResource(load,0,false,Boolean(input));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    function number(name: string) {
      const value = String(values.get(name) ?? '');
      return value ? Number(value) : undefined;
    }
    const clicks = number('clicks'), conversions = number('conversions'), value = number('value');
    const ads = number('ads'), cost = number('cost'), margin = number('margin');
    setInput({ currency:'HKD', impressions:number('impressions'), click_rate:clicks === undefined ? undefined : (clicks / 100).toFixed(6),
      conversion_rate:conversions === undefined ? undefined : (conversions / 100).toFixed(6),
      value_per_conversion_minor:value === undefined ? undefined : Math.round(value * 100),
      advertising_spend_minor:ads === undefined ? undefined : Math.round(ads * 100),
      campaign_cost_minor:cost === undefined ? undefined : Math.round(cost * 100),
      contribution_margin:margin === undefined ? undefined : (margin / 100).toFixed(6) });
  }
  return <section className="hl-scenario">
    <h2>Scenario assumptions</h2><p>Enter your own assumptions for a what-if calculation. Leave any unknown values blank.</p>
    {quoted !== undefined && <p className="hl-note">Selected creator quotes total {amount(quoted)}. Enter your full campaign cost separately.</p>}
    <form className="hl-form-grid" onSubmit={submit}>
      <label>Impressions<input type="number" name="impressions" min={0} max={1000000000000} /></label>
      <label>Click rate (%)<input type="number" name="clicks" min={0} max={100} step={0.01} /></label>
      <label>Conversion rate (%)<input type="number" name="conversions" min={0} max={100} step={0.01} /></label>
      <label>Value per conversion (HK$)<input type="number" name="value" min={0} max={10000000} step={0.01} /></label>
      <label>Advertising spend (HK$)<input type="number" name="ads" min={0} max={10000000} step={0.01} /></label>
      <label>Total campaign cost (HK$)<input type="number" name="cost" min={0} max={10000000} step={0.01} /></label>
      <label>Contribution margin (%)<input type="number" name="margin" min={0} max={100} step={0.01} /></label>
      <div><button type="submit" disabled={input !== undefined && result.state === 'loading'}>Calculate scenario</button></div>
    </form>
    {input && result.state === 'loading' && <Pending>Calculating from your assumptions…</Pending>}
    {result.state === 'error' && <IntelligenceError error={result.error} retry={retry} />}
    {result.state === 'ready' && <div className="hl-decision">
      <strong>Assumption-based scenario</strong>
      <dl className="hl-scenario-results">
          <div><dt>Clicks</dt><dd>{measureText(result.data.clicks)}</dd></div>
          <div><dt>Conversions</dt><dd>{measureText(result.data.conversions)}</dd></div>
          <div><dt>Attributed revenue</dt><dd>{result.data.attributed_revenue_minor.value === null ? 'Unavailable' : amount(Number(result.data.attributed_revenue_minor.value))}</dd></div>
          <div><dt>ROAS</dt><dd>{result.data.roas.value === null ? 'Unavailable' : measureText(result.data.roas) + '×'}</dd></div>
          <div><dt>Contribution-based ROI</dt><dd>{measureText(result.data.roi,true)}</dd></div>
        </dl><p className="hl-note">ROAS uses attributed revenue and advertising spend. ROI uses contribution after campaign cost.</p>
    </div>}
  </section>;
}

export function ConnectedPlan({ mode }: { mode: DataMode }) {
  const { report, setReport, path, draft } = useMarketing();
  const current = report?.mode === mode && reportCurrent(report) ? report : undefined;
  const [included, setIncluded] = useState(() => current?.plan.selected.length ? current.plan.selected : current?.recommendations.map(candidate => candidate.creator_id) ?? []);
  const [input, setInput] = useState<CampaignRequest>();
  const [exported, setExported] = useState(false);
  const load = useCallback((signal: AbortSignal) => runCampaign(mode,input!,signal), [mode,input]);
  const { result, retry } = useResource(load,0,false,Boolean(input));
  const running = Boolean(input) && result.state === 'loading';

  useEffect(() => {
    if (result.state === 'ready') setReport(result.data);
    else if (result.state === 'error' && (result.error.status === 403 || result.error.code === 'catalog_changed')) setReport(undefined);
  }, [result,setReport]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || !included.length || included.length > 40) return;
    const form = new FormData(event.currentTarget);
    const count = Number(form.get('count'));
    setExported(false);
    setInput({ ...report.campaign, budget_minor: Math.round(Number(form.get('budget')) * 100),
      minimum_creators:count, maximum_creators:count, shortlist:included });
  }

  const active = current?.plan;
  const selected = current?.recommendations.filter(candidate => active?.selected.includes(candidate.creator_id)) ?? [];
  const confirmed = active?.status === 'optimal' && active.total_minor !== null ? active.total_minor : undefined;
  const manual = Boolean(draft.brief.required.trim());
  const status = active?.status === 'optimal'
    ? manual ? 'Allocation fits the budget · Manual review pending' : 'Feasible within budget'
    : active?.status === 'infeasible' ? 'No feasible combination under this budget and scope'
    : active?.status === 'search_limit' ? 'Selection could not be resolved within the search limit' : 'Campaign plan unresolved';
  function exportPlan() {
    const rows: (string|number)[][] = [['Classification', mode === 'demo' ? 'Fictional backend demo' : 'Local campaign draft'],
      ['Campaign',draft.brief.name],['Budget cap (HKD)',(current?.campaign.budget_minor ?? draft.brief.budget * 100)/100],
      ['Mandatory notes',draft.brief.required],['Optional notes',draft.brief.preferred]];
    if (mode === 'demo') {
      rows.push(['Plan status',status],['Confirmed spend (HKD)',confirmed === undefined ? 'Unavailable' : confirmed / 100], [],
        ['Selected fictional creator','Firm quote (HKD)']);
      for (const item of selected) rows.push([item.name,item.quote?.data.amount_minor == null ? 'Unavailable' : item.quote.data.amount_minor / 100]);
    }
    exportCsv(rows,mode === 'demo' ? 'harbourline-backend-demo.csv' : 'harbourline-draft.csv');
    setExported(true);
  }
  return <div className="hl-page hl-plan">
    <p className="hl-crumb">{draft.brief.name || 'Campaign workspace'}</p>
    <div className="hl-page-heading"><div><h1>Campaign plan</h1><p>Review quoted allocations and test a different budget or candidate selection.</p></div>
      {draft.saved && <button type="button" className="hl-primary" disabled={running}
        onClick={exportPlan}>{mode === 'demo' ? 'Export plan CSV' : 'Export draft CSV'}</button>}</div>
    {exported && <p role="status">CSV exported.</p>}
    {result.state === 'error' && <IntelligenceError error={result.error} retry={retry} />}
    {!current ? <div className="hl-decision hl-warning"><p>{report ? 'Evidence has expired. Refresh the campaign evaluation.' : 'Evaluate a campaign brief before selecting eligible allocations.'}</p>
      <Link to={path('advisor')}>Open Campaign Advisor</Link></div> : <>
      <form className="hl-plan-scope" onSubmit={submit}>
        <label>Budget cap (HK$)<input type="number" name="budget" required min={0} max={10000000} step={0.01} defaultValue={current.campaign.budget_minor/100} /></label>
        <label>Required creators<input type="number" name="count" required min={1} max={8} defaultValue={current.campaign.minimum_creators} /></label>
        <button type="submit" disabled={running || !included.length || included.length > 40}>Recalculate selection</button>
      </form>
      {running && <Pending>Rechecking eligibility and quotes…</Pending>}
      {!running && result.state !== 'error' && <section className={`hl-decision ${confirmed === undefined || manual ? 'hl-warning' : ''}`} aria-label="Confirmed selection">
        <strong>{status}</strong><p>{confirmed === undefined ? 'Confirmed spend unavailable.' : amount(confirmed) + ' confirmed for ' + selected.length + (selected.length === 1 ? ' creator allocation.' : ' creator allocations.')}</p>
        {current.unavailable_shortlist_ids.length > 0 && <p>{current.unavailable_shortlist_ids.length} selected creators are unavailable.</p>}</section>}
      {selected.length > 0 && <section className="hl-plan-lines"><h2>Selected allocations</h2>
        {selected.map(candidate => <article className="hl-selection-row" key={candidate.creator_id}><h3>{candidate.name}</h3>
          <QuoteEvidence quote={candidate.quote} mode={mode} />{candidate.historical.median_views.value !== null &&
            <details><summary>Historical observations</summary><HistoricMetrics history={candidate.historical} /></details>}</article>)}</section>}
      <details className="hl-candidate-editor">
        <summary>Candidate pool · {included.length} checked</summary>
        <p className="hl-note">Choose the pool for the next calculation. The engine checks current quotes and campaign constraints.</p>
        {current.campaign.shortlist && <button type="button" disabled={running} onClick={() => setInput({ ...current.campaign, shortlist: undefined })}>Restore full candidate pool</button>}
        {included.length > 40 && <p role="status">Choose up to 40 candidates to recalculate.</p>}
        {!current.recommendations.length && <p>No eligible catalog records are available.</p>}
        {current.recommendations.map(candidate => <article key={candidate.creator_id} className="hl-selection-row">
          <label className="hl-check"><input type="checkbox" checked={included.includes(candidate.creator_id)} disabled={running}
            onChange={event => setIncluded(old => event.target.checked ? [...old,candidate.creator_id] : old.filter(id => id !== candidate.creator_id))} />
            <strong>{candidate.name}</strong></label>
          <p className="hl-note">{active?.selected.includes(candidate.creator_id) ? 'Selected in the latest allocation' : candidate.eligible
            ? 'Eligible alternative' : candidate.limitations.join(' · ').replaceAll('_',' ') || 'Requirements need review'}</p>
        </article>)}
      </details>
    </>}
    <Assumptions mode={mode} quoted={!running && result.state !== 'error' ? confirmed : undefined} />
  </div>;
}