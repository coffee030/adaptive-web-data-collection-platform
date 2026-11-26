import { Link } from 'react-router';
import { Loading } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobsPath, newJobPath } from '../collection-jobs/api';
import { recordsPath } from '../results/api';
import { sourcesPath } from '../sources/api';
import { topicsPath } from '../topic-collections/api';

export const operationsPath = '/operations';
export const datasetsPath = operationsPath + '/intelligence-datasets';
export const researchPath = operationsPath + '/creator-research';
export const directoryPath = operationsPath + '/public-directory';

const checkHealth = (signal: AbortSignal) => apiGet<{ status: string }>('/health', signal);

const workflows: { label: string; description: string; actions: [string, string][] }[] = [
  { label: 'Creator data', description: 'Maintain the records available for creator research.',
    actions: [[datasetsPath, 'Intelligence datasets'], [directoryPath, 'Public creator directory'], [researchPath, 'Creator research and refresh']] },
  { label: 'Source setup', description: 'Approve a source and its extraction rules before collecting.',
    actions: [[sourcesPath, 'Manage sources'], [topicsPath, 'Review topic bindings']] },
  { label: 'Collection & quality', description: 'Start a collection or trace a result back to its evidence.',
    actions: [[newJobPath, 'Single-source collection and CSV'], [jobsPath, 'Collection Jobs'], [recordsPath, 'Browse validated records']] },
];

export function OperationsTasks() {
  const { result, retry } = useResource(checkHealth);
  return <section className="operations-tasks" aria-labelledby="operations-tasks-title">
    <div className="operations-section-heading">
      <h2 id="operations-tasks-title">Operations desk</h2>
      <div className="operations-health" role="status">
        {result.state === 'loading' ? <Loading>Checking API and database health…</Loading>
          : result.state === 'ready' && result.data.status === 'ok'
            ? <span className="operations-health-ok">API and database available</span>
            : <span>API and database health unavailable</span>}
        <button type="button" disabled={result.state === 'loading'} onClick={retry}>Check health</button>
      </div>
    </div>
    <dl className="operations-workflows">{workflows.map(group => <div key={group.label}>
      <dt>{group.label}</dt>
      <dd>{group.description}</dd>
      <dd className="operations-actions">{group.actions.map(([url, label]) =>
        <Link key={url} to={url}>{label}<span aria-hidden="true">↗</span></Link>)}</dd>
    </div>)}</dl>
  </section>;
}
