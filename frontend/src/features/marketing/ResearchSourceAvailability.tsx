import { Panel } from '../../components/studio/Workspace';
import { date } from './intelligence';
import type { ResearchRun } from './researchClient';

const states: Record<string, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  expired: 'Expired',
  stale: 'Due for refresh',
  pending: 'Pending',
};

export function ResearchSourceAvailability({ sources, onRefresh, refreshing }: {
  sources: ResearchRun['sources'];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const recorded = sources ?? [];
  return (
    <Panel title="Recorded source availability" description="This run’s receipt lists recorded availability. Search coverage and per-source query activity are unknown.">
      <div className="rc-inset">
        {!recorded.length ? <p>Source availability was not recorded for this run.</p> : (
          <ul className="rc-availability">
            {recorded.map((source) => (
              <li key={source.key}>
                <strong>{source.name}</strong>
                <span>{states[source.state] ?? 'Availability unknown'}
                  {source.pending && ' · Refresh pending'}
                  {source.error && ' · Refresh issue recorded'}
                </span>
                <span>{source.observed_at ? 'Source data observed ' + date(source.observed_at) : 'Observation date unknown'}</span>
              </li>
            ))}
          </ul>
        )}
        <button className="studio-secondary" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? 'Requesting evidence refresh…' : 'Refresh evidence for this run'}
        </button>
      </div>
    </Panel>
  );
}