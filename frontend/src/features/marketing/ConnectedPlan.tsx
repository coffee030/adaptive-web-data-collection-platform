import { useCallback, useState, useRef, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router';
import { apiAttachment } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { HistoricMetrics, IntelligenceError, Pending, QuoteEvidence, measureText } from './IntelligenceEvidence';
import { useEvaluation } from './useEvaluation';
import { amount, calculateScenario, runCampaign, type DataMode, type ScenarioRequest } from './intelligence';
import { useMarketing } from './workspace';
import { exportCsv } from './CampaignPlan';

function Assumptions({ mode, quoted }: { mode: DataMode; quoted?: number }) {
  const { draft, setDraft } = useMarketing();
  const input = draft.scenario;
  const [edited, setEdited] = useState(false);
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
    const scenario: ScenarioRequest = { currency:'HKD', impressions:number('impressions'), click_rate:clicks === undefined ? undefined : (clicks / 100).toFixed(6),
      conversion_rate:conversions === undefined ? undefined : (conversions / 100).toFixed(6),
      value_per_conversion_minor:value === undefined ? undefined : Math.round(value * 100),
      advertising_spend_minor:ads === undefined ? undefined : Math.round(ads * 100),
      campaign_cost_minor:cost === undefined ? undefined : Math.round(cost * 100),
      contribution_margin:margin === undefined ? undefined : (margin / 100).toFixed(6) };
    setEdited(false);
    setDraft(old => ({ ...old, scenario }));
  }
  function initial(value: string | number | undefined, scale = 1) {
    return value == null ? undefined : Number((Number(value) * scale).toFixed(6));
  }
  return <section className="hl-scenario">
    <h2>Scenario assumptions</h2><p>Enter your own assumptions for a what-if calculation. Leave any unknown values blank.</p>
    {quoted !== undefined && <p className="hl-note">Selected creator quotes total {amount(quoted)}. Enter your full campaign cost separately.</p>}
    <form className="hl-form-grid" onSubmit={submit} onChange={() => setEdited(true)}>
      <label>Impressions<input type="number" name="impressions" defaultValue={initial(input?.impressions)} min={0} max={1000000000000} /></label>
      <label>Click rate (%)<input type="number" name="clicks" defaultValue={initial(input?.click_rate, 100)} min={0} max={100} step={0.01} /></label>
      <label>Conversion rate (%)<input type="number" name="conversions" defaultValue={initial(input?.conversion_rate, 100)} min={0} max={100} step={0.01} /></label>
      <label>Value per conversion (HK$)<input type="number" name="value" defaultValue={initial(input?.value_per_conversion_minor, 0.01)} min={0} max={10000000} step={0.01} /></label>
      <label>Advertising spend (HK$)<input type="number" name="ads" defaultValue={initial(input?.advertising_spend_minor, 0.01)} min={0} max={10000000} step={0.01} /></label>
      <label>Total campaign cost (HK$)<input type="number" name="cost" defaultValue={initial(input?.campaign_cost_minor, 0.01)} min={0} max={10000000} step={0.01} /></label>
      <label>Contribution margin (%)<input type="number" name="margin" defaultValue={initial(input?.contribution_margin, 100)} min={0} max={100} step={0.01} /></label>
      <div><button type="submit" disabled={input !== undefined && result.state === 'loading'}>Calculate scenario</button></div>
    </form>
    {input && result.state === 'loading' && <Pending>Calculating from your assumptions…</Pending>}
    {result.state === 'error' && <IntelligenceError error={result.error} retry={retry} />}
    {edited && input && <p role="status">Calculate again to apply your changed assumptions.</p>}
    {!edited && result.state === 'ready' && <div className="hl-decision">
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
  const { path, draft, campaignReceipt } = useMarketing();
  const { current, evaluate, running, error, retry } = useEvaluation(mode);
  const [pool, setPool] = useState<string[]>();
  const included = pool ?? current?.campaign.shortlist ?? (current?.plan.selected.length
    ? current.plan.selected : current?.recommendations.map(candidate => candidate.creator_id)) ?? [];
  const [exported, setExported] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !included.length || included.length > 40) return;
    const form = new FormData(event.currentTarget);
    const count = Number(form.get('count'));
    setExported(false);
    evaluate({ ...current.campaign, budget_minor: Math.round(Number(form.get('budget')) * 100),
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
  const [exportError,setExportError] = useState('');
  const [checkingExport,setCheckingExport] = useState(false);
  const exportRequest = useRef<AbortController>(undefined);
  useEffect(() => () => exportRequest.current?.abort(), []);
  async function exportPlan() {
    setExportError('');
    setExported(false);
    if (campaignReceipt) {
      if (campaignReceipt.pending || exportRequest.current) return;
      const controller = new AbortController();
      exportRequest.current = controller;
      setCheckingExport(true);
      try {
        const blob = await apiAttachment('/marketing/companies/campaigns/'+campaignReceipt.id+'/export?version='+campaignReceipt.version,controller.signal,'text/csv');
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href=href; link.download='harbourline-campaign.csv'; link.click();
        window.setTimeout(()=>URL.revokeObjectURL(href),1000);
        setExported(true);
      } catch { if (!controller.signal.aborted) setExportError('Could not export this campaign. Check your sign-in and reopen its latest saved version.'); }
      finally { exportRequest.current=undefined; if (!controller.signal.aborted) setCheckingExport(false); }
      return;
    }
    if (mode === 'demo') {
      if (!current || exportRequest.current) return;
      const controller = new AbortController();
      exportRequest.current = controller;
      setCheckingExport(true);
      try {
        const fresh = await runCampaign(mode, current.campaign, controller.signal);
        if (fresh.revision !== current.revision || fresh.retrieval !== current.retrieval
          || JSON.stringify(fresh.plan) !== JSON.stringify(current.plan)) {
          retry();
          setExportError('The allocation or its evidence changed. Review the updated plan before exporting.');
          return;
        }
      } catch {
        if (!controller.signal.aborted) setExportError('Could not check the current evidence. Retry the export.');
        return;
      } finally {
        exportRequest.current = undefined;
        if (!controller.signal.aborted) setCheckingExport(false);
      }
    }
    const rows: (string|number)[][] = [['Classification', mode === 'demo' ? 'Fictional backend demo' : 'Local campaign draft'],
      ['Campaign',draft.brief.name],['Budget cap (HKD)',(current?.campaign.budget_minor ?? draft.brief.budget * 100)/100],
      ['Brief',draft.brief.description],['Platform',draft.brief.platform],['Deliverable',draft.brief.deliverable],
      ['Required creators',draft.brief.creatorCount],['Required content evidence',draft.brief.requiredFacts ?? ''],
      ['Mandatory notes',draft.brief.required],['Optional notes',draft.brief.preferred]];
    if (mode === 'demo') {
      rows.push(['Plan status',status],['Confirmed spend (HKD)',confirmed === undefined ? 'Unavailable' : confirmed / 100], [],
        ['Selected fictional creator','Firm quote (HKD)','Quote evidence','Supporting post evidence']);
      for (const item of selected) rows.push([item.name,item.quote?.data.amount_minor == null ? 'Unavailable' : item.quote.data.amount_minor / 100,
        item.quote?.evidence.reference ?? 'Unavailable',item.evidence.map(post => post.content.evidence.reference).join(', ')]);
    }
    const assumptions = draft.scenario;
    if (assumptions) {
      rows.push([], ['Scenario assumptions','User supplied'], ['Impressions',assumptions.impressions ?? 'Unavailable'],
        ['Click rate (fraction)',assumptions.click_rate ?? 'Unavailable'], ['Conversion rate (fraction)',assumptions.conversion_rate ?? 'Unavailable'],
        ['Value per conversion (HKD)',assumptions.value_per_conversion_minor == null ? 'Unavailable' : assumptions.value_per_conversion_minor / 100],
        ['Advertising spend (HKD)',assumptions.advertising_spend_minor == null ? 'Unavailable' : assumptions.advertising_spend_minor / 100],
        ['Campaign cost (HKD)',assumptions.campaign_cost_minor == null ? 'Unavailable' : assumptions.campaign_cost_minor / 100],
        ['Contribution margin (fraction)',assumptions.contribution_margin ?? 'Unavailable']);
    }
    exportCsv(rows,mode === 'demo' ? 'harbourline-backend-demo.csv' : 'harbourline-draft.csv');
    setExported(true);
  }
  return <div className="hl-page hl-plan">
    <p className="hl-crumb">{draft.brief.name || 'Campaign workspace'}</p>
    <div className="hl-page-heading"><div><h1>Campaign plan</h1><p>Review quoted allocations and test a different budget or candidate selection.</p></div>
      {draft.saved && <button type="button" className="hl-primary" disabled={campaignReceipt?.pending || checkingExport || running || Boolean(error) || (mode === 'demo' && !current)}
        onClick={exportPlan}>{mode === 'demo' ? 'Export plan CSV' : 'Export draft CSV'}</button>}</div>
    {exportError && <p role="alert">{exportError}</p>}
    {exported && <p role="status">CSV exported.</p>}
    {error && <IntelligenceError error={error} retry={retry} />}
    {running ? <Pending>Checking current campaign evidence…</Pending> : !current ? <div className="hl-decision hl-warning"><p>Evaluate the campaign brief to see eligible allocations.</p>
      <Link to={path('advisor')}>Open Campaign Advisor</Link></div> : <>
      <form className="hl-plan-scope" onSubmit={submit}>
        <label>Budget cap (HK$)<input type="number" name="budget" required min={0} max={10000000} step={0.01} defaultValue={current.campaign.budget_minor/100} /></label>
        <label>Required creators<input type="number" name="count" required min={1} max={8} defaultValue={current.campaign.minimum_creators} /></label>
        <button type="submit" disabled={running || !included.length || included.length > 40}>Recalculate selection</button>
      </form>
      {!running && !error && <section className={`hl-decision ${confirmed === undefined || manual ? 'hl-warning' : ''}`} aria-label="Confirmed selection">
        <strong>{status}</strong><p>{confirmed === undefined ? 'Confirmed spend unavailable.' : amount(confirmed) + ' confirmed for ' + selected.length + (selected.length === 1 ? ' creator allocation.' : ' creator allocations.')}</p>
        {confirmed !== undefined && <div className="hl-budget-usage">
          {current.campaign.budget_minor > 0 && <meter aria-label="Confirmed creator spend against the budget" min={0} max={current.campaign.budget_minor} value={confirmed}/>}
          {amount(current.campaign.budget_minor - confirmed)} remaining of {amount(current.campaign.budget_minor)}
        </div>}
        {current.unavailable_shortlist_ids.length > 0 && <p>{current.unavailable_shortlist_ids.length} selected creators are unavailable.</p>}</section>}
      {selected.length > 0 && <section className="hl-plan-lines"><h2>Selected allocations</h2>
        {selected.map(candidate => <article className="hl-selection-row" key={candidate.creator_id}><h3>{candidate.name}</h3>
          <QuoteEvidence quote={candidate.quote} mode={mode} />{candidate.historical.median_views.value !== null &&
            <details><summary>Historical observations</summary><HistoricMetrics history={candidate.historical} /></details>}</article>)}</section>}
      <details className="hl-candidate-editor">
        <summary>Candidate pool · {included.length} checked</summary>
        <p className="hl-note">Choose the pool for the next calculation. The engine checks current quotes and campaign constraints.</p>
        {current.campaign.shortlist && <button type="button" disabled={running} onClick={() => { setPool(undefined); evaluate({ ...current.campaign, shortlist: undefined }); }}>Restore full candidate pool</button>}
        {included.length > 40 && <p role="status">Choose up to 40 candidates to recalculate.</p>}
        {!current.recommendations.length && <p>No eligible catalog records are available.</p>}
        {current.recommendations.map(candidate => <article key={candidate.creator_id} className="hl-selection-row">
          <label className="hl-check"><input type="checkbox" checked={included.includes(candidate.creator_id)} disabled={running}
            onChange={event => setPool(event.target.checked ? [...included,candidate.creator_id] : included.filter(id => id !== candidate.creator_id))} />
            <strong>{candidate.name}</strong></label>
          <p className="hl-note">{active?.selected.includes(candidate.creator_id) ? 'Selected in the latest allocation' : candidate.eligible
            ? 'Eligible alternative' : candidate.limitations.join(' · ').replaceAll('_',' ') || 'Requirements need review'}</p>
        </article>)}
      </details>
    </>}
    <Assumptions mode={mode} quoted={!running && !error ? confirmed : undefined} />
  </div>;
}
