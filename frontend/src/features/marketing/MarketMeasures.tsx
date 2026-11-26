import { useState } from 'react';
import { Panel } from '../../components/studio/Workspace';
import {
  BusinessProblem,
  displayDate,
  marketBase,
  Platform,
  useBusinessResource,
} from './marketLibrary';

interface Distribution {
  platform: string;
  key: string;
  label: string;
  works: number;
  median: number;
  lower_quartile: number;
  upper_quartile: number;
  observed_through: string;
  definition: string;
}

const value = (n: number) => n.toLocaleString('en-HK', { maximumFractionDigits: 1 });

export function MarketMeasures({ creatorId }: { creatorId?: string }) {
  const [days, setDays] = useState('');
  const query = new URLSearchParams();
  if (creatorId) query.set('creator_id', creatorId);
  if (days) query.set('days', days);
  const request = useBusinessResource<Distribution[]>(marketBase + '/measurements?' + query);
  const state = request.result;
  return (
    <Panel
      title={creatorId ? 'Historical interactions' : 'Historical platform interactions'}
      description="Latest reported counter per eligible work. Publication dates determine the selected window."
      actions={
        !creatorId && (
          <label className="measure-window">
            Publication window
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="">All collected work</option>
              <option value="30">Past 30 days</option>
              <option value="90">Past 90 days</option>
              <option value="365">Past year</option>
            </select>
          </label>
        )
      }
    >
      {state.state === 'loading' ? (
        <p role="status">Loading historical interactions…</p>
      ) : state.state === 'error' ? (
        <BusinessProblem error={state.error} retry={request.retry} />
      ) : state.data.length === 0 ? (
        <p>No interaction measurements are available for this selection.</p>
      ) : (
        <div
          className="studio-table-scroll measure-table"
          role="region"
          tabIndex={0}
          aria-label="Historical interaction measures"
        >
          <table className="studio-table">
            <thead>
              <tr>
                {!creatorId && <th>Platform</th>}
                <th>Measure</th>
                <th>Median per work</th>
                {!creatorId && <th>Middle 50%</th>}
                <th>Works measured</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((row) => (
                <tr key={row.platform + ':' + row.key}>
                  {!creatorId && (
                    <td className="measure-platform">
                      <Platform value={row.platform} />
                    </td>
                  )}
                  <th scope="row">{row.label}</th>
                  <td className="measure-median">
                    <span className="measure-label">Median </span>
                    {value(row.median)}
                    <small className="measure-sample">
                      {value(row.works)} {row.works === 1 ? 'work' : 'works'} ·{' '}
                      {displayDate(row.observed_through)}
                    </small>
                  </td>
                  {!creatorId && (
                    <td className="measure-range">
                      <span className="measure-label">Middle 50% · </span>
                      {row.works >= 4
                        ? value(row.lower_quartile) + ' – ' + value(row.upper_quartile)
                        : 'Fewer than 4 works'}
                    </td>
                  )}
                  <td>
                    {value(row.works)}
                    {!creatorId && <small>Observed through {displayDate(row.observed_through)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
