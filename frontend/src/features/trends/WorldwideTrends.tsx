import { Link, useSearchParams } from 'react-router';
import { Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { worldwideTrendsPath } from '../operator/OperationsTasks';
import { sourcePath } from '../sources/api';
import { Resource } from '../topic-collections/support';
import { getProvider, problemText } from './api';
import { DiscoveryPane } from './DiscoveryPane';
import { SavedSeries } from './SavedSeries';
import './trends.css';

export function WorldwideTrends() {
  const [params] = useSearchParams();
  const saved = params.get('view') === 'saved';
  const state = useResource(getProvider, 0, true);
  return <div className="trend-workspace">
    <div className="page-heading operator-title"><h1>Worldwide trends</h1>
      <p>Discover popular Wikipedia articles by language edition and compare daily article pageviews. Reader location is unavailable.</p></div>
    <nav className="trend-nav" aria-label="Trend views">
      <Link to={worldwideTrendsPath} aria-current={saved ? undefined : 'page'}>Discover articles</Link>
      <Link to={worldwideTrendsPath + '?view=saved'} aria-current={saved ? 'page' : undefined}>Saved series and comparison</Link>
    </nav>
    <Resource state={state} label="Wikimedia source status">{source => <>
      <div className="trend-source">
        <div className="trend-actions"><strong>Wikimedia source</strong><span>{source.authorized ? 'Approved' : source.configured ? 'Approval inactive' : 'Awaiting approval'}</span>
          <button type="button" onClick={state.retry}>Refresh source status</button></div>
        {(source.blocked || source.last_error) && <p role="status">{source.last_error ? problemText(source.last_error) : 'Publisher requests are blocked.'}</p>}
        <details><summary>Source access and timing</summary>
          {source.next_request_at && <p>Next permitted request (UTC) <Timestamp value={source.next_request_at} /></p>}
          <div className="trend-actions"><a href={source.policy}>Wikimedia access policy ↗</a><a href={source.data_license}>CC0 licence ↗</a>
            {source.source_id && <Link to={sourcePath(source.source_id)}>Inspect Core source</Link>}</div>
        </details>
      </div>
      {saved ? <SavedSeries key={params.toString()} provider={source} refreshProvider={state.retry} />
        : <DiscoveryPane provider={source} refresh={state.retry} />}
    </>}</Resource>
  </div>;
}
