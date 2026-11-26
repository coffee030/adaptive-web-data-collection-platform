import { useCallback, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Timestamp } from '../../components/feedback';
import { apiGet, apiPatch } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath } from '../collection-jobs/api';
import { ActionFeedback, Resource, useAction } from '../topic-collections/support';
import { actionProblem, articleTitle, daysAgo, getSeries, problemText, trendBase, type Comparison, type Provider, type Series } from './api';
import { TrendComparison } from './TrendComparison';

function Schedule({ series, provider, refresh }: { series: Series; provider: Provider; refresh: () => void }) {
  const action = useAction(actionProblem, series.id);
  const activationDisabled = !series.active && (!provider.authorized || provider.blocked);
  return <details className="trend-schedule">
    <summary>{series.active ? 'Active' : 'Paused'} · Schedule details</summary>
    <dl><dt>First date</dt><dd>{series.start_day}</dd><dt>Next data date</dt><dd>{series.next_day}</dd>
      {series.active && <><dt>Next check (UTC)</dt><dd><Timestamp value={series.due_at} /></dd></>}
      <dt>Last capture (UTC)</dt><dd><Timestamp value={series.last_capture_at} /></dd>
      {series.last_error && <><dt>Last issue</dt><dd>{problemText(series.last_error)}</dd></>}
      {series.pending_job && <><dt>In progress</dt><dd><Link to={jobPath(series.pending_job)}>Open pending job</Link></dd></>}
      {series.last_job && <><dt>Last job</dt><dd><Link to={jobPath(series.last_job)}>Open last job</Link></dd></>}
    </dl>
    <button type="button" disabled={action.busy || activationDisabled} onClick={() => {
      void action.run(signal => apiPatch<Series>(trendBase + '/series/' + series.id, { active: !series.active }, signal), refresh);
    }}>{series.active ? 'Pause' : 'Resume'} {series.topic}</button>
    {series.active && series.pending_job && <p>A job already in progress can finish after a pause.</p>}
    <ActionFeedback action={action} pending="Updating schedule…" />
  </details>;
}

export function SavedSeries({ provider, refreshProvider }: { provider: Provider; refreshProvider: () => void }) {
  const inventory = useResource(getSeries, 0, true);
  const [params, setParams] = useSearchParams();
  const submitted = params.getAll('watch_id');
  const first = params.get('start') ?? daysAgo(8);
  const last = params.get('end') ?? daysAgo(2);
  const [selected, setSelected] = useState(submitted);
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(last);
  const [rangeError, setRangeError] = useState('');
  const [submittedHere, setSubmittedHere] = useState(false);
  const matches = selected.join(',') === submitted.join(',') && start === first && end === last;
  const show = submitted.length > 0 && matches && provider.authorized;
  const read = new URLSearchParams({ start: first, end: last });
  submitted.forEach(id => read.append('watch_id', id));
  const query = read.toString();
  const load = useCallback((signal: AbortSignal) => apiGet<Comparison>(trendBase + '/compare?' + query, signal), [query]);
  const comparison = useResource(load, 0, false, show);
  function change(id: string) {
    setSelected(old => old.includes(id) ? old.filter(item => item !== id) : old.length < 8 ? [...old, id] : old);
  }
  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const days = (Date.parse(end) - Date.parse(start)) / 86400000;
    if (days < 0 || days >= 90) {
      setRangeError('Choose an ordered UTC interval of at most 90 days.');
      return;
    }
    setRangeError('');
    if (matches) {
      setSubmittedHere(true);
      comparison.retry();
    }
    else {
      const next = new URLSearchParams({ view: 'saved', start, end });
      selected.forEach(id => next.append('watch_id', id));
      setParams(next, { preventScrollReset: true });
    }
  }

  return <>
    <section className="panel operator-sheet" aria-labelledby="saved-trend-series">
      <div className="panel-heading"><h2 id="saved-trend-series">Saved series</h2>
        <button type="button" onClick={() => { inventory.retry(); refreshProvider(); comparison.retry(); }}>Refresh schedules</button></div>
      <Resource state={inventory} label="saved article series">{rows => rows.length ? <>
        <p className="trend-note">Select up to eight articles. Edition identifies the publishing Wikipedia site.</p>
        <table className="operator-ledger"><caption className="sr-only">Saved Wikimedia article series</caption>
          <thead><tr><th scope="col">Compare</th><th scope="col">Topic and article</th><th scope="col">Collection schedule</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td data-label="Compare"><input type="checkbox" aria-label={'Compare ' + row.topic + ', ' + articleTitle(row.article) + ', ' + row.project}
              checked={selected.includes(row.id)} disabled={!selected.includes(row.id) && selected.length >= 8} onChange={() => change(row.id)} /></td>
            <th scope="row">{row.topic}<small>{articleTitle(row.article)} · {row.project}</small></th>
            <td data-label="Schedule"><Schedule series={row} provider={provider} refresh={inventory.retry} /></td>
          </tr>)}</tbody>
        </table>
        <form className="trend-controls" onSubmit={run} onChange={() => setRangeError('')}>
          <label>From (UTC)<input type="date" name="start" value={start} onChange={event => setStart(event.currentTarget.value)} min="2015-07-01" max={daysAgo(1)} required /></label>
          <label>Through (UTC)<input type="date" name="end" value={end} onChange={event => setEnd(event.currentTarget.value)} min="2015-07-01" max={daysAgo(1)} required /></label>
          <button type="submit" className="primary" disabled={!selected.length || !provider.authorized}>Compare selected ({selected.length})</button>
        </form>
        {rangeError && <p className="notice" role="alert">{rangeError}</p>}
      </> : <p className="notice">No saved series. Use Discover articles to choose an edition, date and article.</p>}</Resource>
    </section>
    {show && <Resource state={comparison} label="dated pageviews">{result => <TrendComparison result={result} submittedHere={submittedHere} />}</Resource>}
  </>;
}
