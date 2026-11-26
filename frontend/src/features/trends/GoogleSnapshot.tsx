import { useCallback } from 'react';
import { Timestamp } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath } from '../collection-jobs/api';
import { evidenceDetailPath, recordPath } from '../results/api';
import { ContextLink, useResultReturn } from '../results/resultNavigation';
import { Resource } from '../topic-collections/support';
import { number } from './api';
import { marketPath, type MarketSnapshot } from './google';

export function GoogleSnapshot({ region, revision }: { region: string; revision: number }) {
  const load = useCallback((signal: AbortSignal) => apiGet<MarketSnapshot>(marketPath(region) + '/snapshot', signal), [region]);
  const state = useResource(load, revision, true);
  useResultReturn(state.result.state === 'ready');
  if (state.result.state === 'error' && state.result.error.code === 'source_not_approved') {
    return <p className="notice" role="status">Snapshot access requires active source approval. Refresh source status to inspect access.</p>;
  }
  return <section className="panel operator-sheet google-snapshot" aria-labelledby="google-latest">
    <div className="panel-heading"><h2 id="google-latest">Latest verified snapshot</h2></div>
    <Resource state={state} label="market snapshot">{snapshot => snapshot.observed_at ? <>
      <div className="trend-body google-snapshot-summary">
        <strong>Google Trends · {snapshot.region} market</strong>
        <span>Feed checked (UTC) <Timestamp value={snapshot.observed_at} /></span>
        <p>Search traffic is approximate. A “+” gives the reported lower bound. “Not provided” means Google omitted the bucket.</p>
        <details><summary>Snapshot source</summary>
          {snapshot.source_url && <p><a href={snapshot.source_url}>Google Trending Now RSS for {region} ↗</a></p>}
          {snapshot.response_sha256 && <p>Response SHA-256 <code>{snapshot.response_sha256}</code></p>}
        </details>
      </div>
      {snapshot.events.length ? <table className="operator-ledger google-events">
        <caption className="sr-only">Google Trending Now searches in {region}</caption>
        <thead><tr><th scope="col">Trending search</th><th scope="col">Approximate traffic</th><th scope="col">First published (UTC)</th></tr></thead>
        <tbody>{snapshot.events.map(row => <tr key={row.event_id}>
          <th scope="row">
            <ContextLink id={'google-record-' + row.record_id} to={recordPath(row.record_id)} aria-label={row.query + ', validated record'}>{row.query}</ContextLink>
            <span className="google-lineage">
              <ContextLink id={'google-job-' + row.record_id} to={jobPath(row.job_id)} aria-label={'Collection job for ' + row.query}>Job</ContextLink>
              <ContextLink id={'google-evidence-' + row.record_id} to={evidenceDetailPath(row.evidence_id)} aria-label={'Normalized evidence for ' + row.query}>Evidence</ContextLink>
            </span>
          </th>
          <td data-label="Approximate traffic"><span>{row.traffic_bucket || 'Not provided'}</span>
            {row.traffic_bucket && row.traffic_lower_bound !== null && <small>Lower bound {number.format(row.traffic_lower_bound)}</small>}
            <small>Traffic observed (UTC) <Timestamp value={row.observed_at} /></small></td>
          <td data-label="First published (UTC)"><Timestamp value={row.published_at} /></td>
        </tr>)}</tbody>
      </table> : <p className="trend-note">Google returned no trending searches in this market at the verified check.</p>}
    </> : <p className="trend-note">No verified snapshot yet. The first successful scheduled check will establish coverage for this market.</p>}</Resource>
  </section>;
}
