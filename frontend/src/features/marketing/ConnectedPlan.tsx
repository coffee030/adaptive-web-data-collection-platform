import { useCallback, useState, useRef, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, apiAttachment } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { HistoricMetrics, IntelligenceError, Pending, QuoteEvidence, measureText } from './IntelligenceEvidence';
import { EvaluationScope } from './EvaluationScope';
import { useEvaluation } from './useEvaluation';
import { amount, calculateScenario, runCampaign, type DataMode } from './intelligence';
import { ScenarioFields, readScenario } from './ScenarioFields';
import { useMarketing } from './workspace';
import { exportCsv } from './CampaignPlan';

function Assumptions({ mode, quoted }: { mode: DataMode; quoted?: number }) {
  const { draft, setDraft } = useMarketing();
  const input = draft.scenario;
  const currency = input?.currency ?? draft.evaluation?.currency ?? 'HKD';
  const [edited, setEdited] = useState(false);
  const load = useCallback((signal: AbortSignal) => calculateScenario(mode,input!,signal), [mode,input]);
  const { result, retry } = useResource(load,0,false,Boolean(input));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scenario = readScenario(event.currentTarget, currency);
    setEdited(false);
    setDraft(old => ({ ...old, scenario }));
  }
  return <section className="hl-scenario">
    <h2>Scenario assumptions</h2><p>Enter your own assumptions for a what-if calculation. Leave any unknown values blank.</p>
    {quoted !== undefined && <p className="hl-note">Selected creator quotes total {amount(quoted, draft.evaluation?.currency ?? currency)}. Enter your full campaign cost separately.</p>}
    <form className="hl-form-grid" onSubmit={submit} onChange={() => setEdited(true)}>
      <ScenarioFields input={input} currency={currency} />
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
          <div><dt>Attributed revenue</dt><dd>{result.data.attributed_revenue_minor.value === null ? 'Unavailable' : amount(Number(result.data.attributed_revenue_minor.value), result.data.assumptions.currency)}</dd></div>
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

  const currency = current?.campaign.currency ?? draft.evaluation?.currency ?? 'HKD';
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
        const params = new URLSearchParams({ version:String(campaignReceipt.version) });
        if (current?.allocation_export_receipt) params.set('allocation', current.allocation_export_receipt);
        const blob = await apiAttachment('/marketing/companies/campaigns/'+campaignReceipt.id+'/export?'+params,controller.signal,'text/csv');
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href=href; link.download='harbourline-campaign.csv'; link.click();
        window.setTimeout(()=>URL.revokeObjectURL(href),1000);
        setExported(true);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && (cause.code==='plan_export_restricted' || cause.code==='catalog_changed')) {
          retry();
          setExportError('The available evidence or its export permission changed. Review the refreshed plan and its export options.');
        } else if (cause instanceof ApiError && cause.status===409) {
          setExportError('A newer company draft is available. Reopen the campaign before exporting.');
        } else if (cause instanceof ApiError && cause.status===401) {
          setExportError('Sign in to the company again to export this campaign.');
        } else {
          setExportError('The export could not be completed. Check the connection and try again.');
        }
      }
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
      ['Campaign',draft.brief.name],['Budget cap (' + currency + ')',(current?.campaign.budget_minor ?? draft.brief.budget * 100)/100],
      ['Brief',draft.brief.description],['Platform',draft.brief.platform],['Deliverable',draft.brief.deliverable],
      ['Required creators',current?.campaign.minimum_creators ?? draft.brief.creatorCount],['Required content evidence',draft.brief.requiredFacts ?? ''],
      ['Mandatory notes',draft.brief.required],['Optional notes',draft.brief.preferred]];
    if (mode === 'demo') {
      rows.push(['Plan status',status],['Evidence reviewed at',current!.as_of],['Confirmed spend (' + currency + ')',confirmed === undefined ? 'Unavailable' : confirmed / 100], [],
        ['Selected fictional creator','Firm quote (' + currency + ')','Quote evidence','Supporting post evidence']);
      for (const item of selected) rows.push([item.name,item.quote?.data.amount_minor == null ? 'Unavailable' : item.quote.data.amount_minor / 100,
        item.quote?.evidence.reference ?? 'Unavailable',item.evidence.map(post => post.content.evidence.reference).join(', ')]);
    }
    const assumptions = draft.scenario;
    if (assumptions) {
      const campaignCost = assumptions.campaign_cost_minor ?? assumptions.spend_minor;
      rows.push([], ['Scenario assumptions','User supplied'], ['Impressions',assumptions.impressions ?? 'Unavailable'],
        ['Click rate (fraction)',assumptions.click_rate ?? 'Unavailable'], ['Conversion rate (fraction)',assumptions.conversion_rate ?? 'Unavailable'],
        ['Value per conversion (' + assumptions.currency + ')',assumptions.value_per_conversion_minor == null ? 'Unavailable' : assumptions.value_per_conversion_minor / 100],
        ['Advertising spend (' + assumptions.currency + ')',assumptions.advertising_spend_minor == null ? 'Unavailable' : assumptions.advertising_spend_minor / 100],
        ['Campaign cost (' + assumptions.currency + ')',campaignCost == null ? 'Unavailable' : campaignCost / 100],
        ['Contribution margin (fraction)',assumptions.contribution_margin ?? 'Unavailable']);
    }
    exportCsv(rows,mode === 'demo' ? 'harbourline-backend-demo.csv' : 'harbourline-draft.csv');
    setExported(true);
  }
  return <div className="hl-page hl-plan">
    <p className="hl-crumb">{draft.brief.name || 'Campaign workspace'}</p>
    <div className="hl-page-heading"><div><h1>Campaign plan</h1><p>Review quoted allocations and test a different budget or candidate selection.</p></div>
      {draft.saved && <button type="button" className="hl-primary" disabled={campaignReceipt?.pending || checkingExport || running || Boolean(error) || (mode === 'demo' && !current)}
        onClick={exportPlan}>{mode === 'demo' || current?.allocation_export_receipt ? active?.status === 'infeasible' ? 'Export infeasible assessment CSV' : 'Export plan CSV' : 'Export draft CSV'}</button>}</div>
    {mode === 'partner' && draft.saved && <p className="hl-note">{current?.allocation_export_receipt ? 'Plan export includes the current allocation, fees and source references approved for your company.' : 'Export your campaign brief and scenario assumptions. Exporting creator allocations requires permission from the source owners.'}</p>}
    {exportError && <p role="alert">{exportError}</p>}
    {exported && <p role="status">CSV exported.</p>}
    {error && <IntelligenceError error={error} retry={retry} />}
    {running ? <Pending>Checking current campaign evidence…</Pending> : !current ? <div className="hl-decision hl-warning"><p>Evaluate the campaign brief to see eligible allocations.</p>
      <Link to={path('advisor')}>Open Campaign Advisor</Link></div> : <>
      <form className="hl-plan-scope" onSubmit={submit}>
        <label>Budget cap ({currency === 'HKD' ? 'HK$' : currency})<input type="number" name="budget" required min={0} max={10000000} step={0.01} defaultValue={current.campaign.budget_minor/100} /></label>
        <label>Required creators<input type="number" name="count" required min={1} max={8} defaultValue={current.campaign.minimum_creators} /></label>
        <button type="submit" disabled={running || !included.length || included.length > 40}>Recalculate selection</button>
      </form>
      {!running && !error && <section className={`hl-decision ${confirmed === undefined || manual ? 'hl-warning' : ''}`} aria-label="Confirmed selection">
        <strong>{status}</strong><p>{confirmed === undefined ? 'Confirmed spend unavailable.' : amount(confirmed, currency) + ' confirmed for ' + selected.length + (selected.length === 1 ? ' creator allocation.' : ' creator allocations.')}</p>
        <EvaluationScope result={current}/>
        {active?.status === 'infeasible' && <div className="hl-actions">
          {current.campaign.shortlist && <button type="button" onClick={() => { setPool(undefined); evaluate({ ...current.campaign, shortlist: undefined }); }}>Evaluate all creators</button>}
          <Link className="hl-button" to={path('advisor')+'#edit-requirements'}>Edit campaign requirements</Link>
        </div>}
        {confirmed !== undefined && <div className="hl-budget-usage">
          {current.campaign.budget_minor > 0 && <meter aria-label="Confirmed creator spend against the budget" min={0} max={current.campaign.budget_minor} value={confirmed}/>}
          {amount(current.campaign.budget_minor - confirmed, currency)} remaining of {amount(current.campaign.budget_minor, currency)}
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
