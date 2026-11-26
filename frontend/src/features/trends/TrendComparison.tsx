import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router';
import { TableRegion, Timestamp } from '../../components/feedback';
import { apiAttachment } from '../../lib/api';
import { jobPath } from '../collection-jobs/api';
import { evidenceDetailPath, recordPath } from '../results/api';
import { rememberPosition, useResultReturn } from '../results/resultNavigation';
import { ActionFeedback, useAction } from '../topic-collections/support';
import { actionProblem, articleTitle, number, trendBase, type Comparison, type Point } from './api';

interface Selection { point: Point; day: string; title: string }

export function TrendComparison({ result, submittedHere }: { result: Comparison; submittedHere: boolean }) {
  const [selected, setSelected] = useState<Selection>();
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const navigation = useNavigationType();
  const focusSummary = submittedHere || navigation === 'PUSH';
  useResultReturn(!focusSummary);
  useEffect(() => {
    if (focusSummary && summary.current) {
      summary.current.focus({ preventScroll: true });
      summary.current.scrollIntoView({ block: 'start' });
    }
  }, [focusSummary]);
  const download = useAction(actionProblem, selected?.point.record_id);
  function show(value: Selection) {
    setSelected(value);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function close() {
    const id = selected?.point.record_id;
    setSelected(undefined);
    if (id) requestAnimationFrame(() => document.getElementById('trend-point-' + id)?.focus());
  }

  function capture(point: Point) {
    void download.run(signal => apiAttachment(trendBase + '/captures/' + point.job_id, signal, 'application/json'), blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wikimedia-' + point.job_id + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  return <section className="panel operator-sheet" aria-labelledby="trend-values">
    <div className="panel-heading"><h2 id="trend-values" ref={summary} tabIndex={-1}>Daily article pageviews</h2><span>{result.days[0]} – {result.days.at(-1)} UTC</span></div>
    <p className="trend-note">Select a count to inspect its source. Zero is an observed count. “Missing” means no published observation for that day.</p>
    {selected && <section className="operator-review trend-point">
      <h3 ref={heading} tabIndex={-1}>Evidence for {selected.title} on {selected.day} UTC</h3>
      <p>{number.format(selected.point.views)} pageviews · Captured <Timestamp value={selected.point.capture_at} /></p>
      <div className="trend-actions" onClick={event => {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) rememberPosition(location.key, 'trend-point-' + selected.point.record_id);
      }}>
        <Link to={jobPath(selected.point.job_id)}>Core job</Link><Link to={recordPath(selected.point.record_id)}>Validated record</Link>
        <Link to={evidenceDetailPath(selected.point.evidence_id)}>Normalized evidence</Link><a href={selected.point.source_url}>Wikimedia source ↗</a>
      </div>
      <details><summary>Response fingerprint</summary><p>SHA-256 <code>{selected.point.response_sha256}</code></p></details>
      <div className="trend-actions"><button type="button" disabled={download.busy} onClick={() => capture(selected.point)}>Download captured JSON</button>
        <button type="button" onClick={close}>Return to count</button></div>
      <ActionFeedback action={download} pending="Opening capture…" />
    </section>}
    <TableRegion label="Daily pageviews aligned by UTC date">
      <table className="trend-grid"><caption className="sr-only">Exact publisher counts by UTC day</caption>
        <thead><tr><th scope="col">Date (UTC)</th>{result.series.map(row => <th scope="col" key={row.id}>
          {row.topic}<small>{articleTitle(row.article)} · {row.project}</small>
          <small>{row.coverage.observed_days} / {row.coverage.requested_days} days observed</small>
        </th>)}</tr></thead>
        <tbody>{result.days.map((day, index) => <tr key={day}><th scope="row">{day}</th>
          {result.series.map(row => { const point = row.points[index]; return <td key={row.id}>{point ? (
            <button type="button" className="trend-count" id={'trend-point-' + point.record_id}
              aria-label={number.format(point.views) + ' pageviews, ' + row.topic + ', ' + row.project + ', ' + day + ' UTC'}
              onClick={() => show({ point, day, title: articleTitle(row.article) + ' · ' + row.project })}>{number.format(point.views)}</button>
          ) : <span className="muted">Missing</span>}</td>; })}
        </tr>)}</tbody>
      </table>
    </TableRegion>
  </section>;
}
