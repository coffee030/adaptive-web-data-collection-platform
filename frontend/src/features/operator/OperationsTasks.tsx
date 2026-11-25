import { Link } from 'react-router';
import { Loading } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobsPath, newJobPath } from '../collection-jobs/api';
import { recordsPath } from '../results/api';
import { sourcesPath } from '../sources/api';
import { topicsPath } from '../topic-collections/api';

export const operationsPath = '/operations';
export const datasetsPath = '/operations/intelligence-datasets';
export const researchPath = '/operations/creator-research';
const checkHealth = (signal: AbortSignal) => apiGet<{ status: string }>('/health', signal);

export function OperationsTasks() {
  const { result, retry } = useResource(checkHealth);
  return <section className="operations-tasks" aria-labelledby="operations-tasks-title">
    <h2 id="operations-tasks-title">Data Operations tasks</h2>
    <div className="operations-task-grid">
      <div><h3>Authorise and configure</h3><p>Check access permissions and review source profiles before collection.</p>
        <Link to={sourcesPath}>Manage sources</Link><Link to={topicsPath}>Review topic bindings</Link></div>
      <div><h3>Collect and import</h3><p>Run an approved source or import an authorised CSV dataset.</p>
        <Link to={newJobPath}>Single-source collection and CSV</Link><Link to={researchPath}>Creator research and refresh</Link><Link to={datasetsPath}>Intelligence datasets</Link></div>
      <div><h3>Review data quality</h3><p>Inspect jobs, quarantine outcomes, validated records and their evidence.</p>
        <Link to={jobsPath}>Collection Jobs</Link><Link to={recordsPath}>Browse validated records</Link></div>
    </div>
    <div className="operations-health">
      {result.state === 'loading' ? <Loading>Checking API and database health…</Loading>
       : result.state === 'error' ? <><strong role="status">API and database health unavailable</strong><button type="button" onClick={retry}>Check health</button></>
       : <><strong>{result.data.status === 'ok' ? 'API and database available' : 'API health could not be verified'}</strong>
          <span>Worker activity is visible through collection jobs.</span><button type="button" onClick={retry}>Check health</button></>}
    </div>
  </section>;
}