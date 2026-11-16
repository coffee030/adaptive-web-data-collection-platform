import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Loading, RequestProblem } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import type { Profile } from '../profiles/api';
import { listSources, listVersions, sourcePath, sourcesPath, type Adapter, type Source } from '../sources/api';
import { allowedInputs } from '../sources/collectionInput';

const formats = [
  { adapter: 'web', label: 'HTML pages', description: 'Collect structured fields from a permitted HTML page.' },
  { adapter: 'csv', label: 'CSV datasets', description: 'Import rows from a permitted CSV dataset.' },
] as const;

type EligibleSource = { source: Source; profiles: Profile[] };

async function eligibleSources(signal: AbortSignal) {
  const registered = await listSources(signal);
  const approved = registered.filter(source => source.approval_status === 'approved' && allowedInputs(source).length > 0);
  const eligible: EligibleSource[] = [];
  let unavailable = 0;
  const batchSize = 4;
  for (let index = 0; index < approved.length; index += batchSize) {
    signal.throwIfAborted();
    const batch = await Promise.allSettled(approved.slice(index, index + batchSize).map(async source => ({
      source,
      profiles: (await listVersions(source.source_id, signal)).filter(profile => profile.approval_status === 'approved'),
    })));
    for (const result of batch) {
      if (result.status === 'rejected') unavailable++;
      else if (result.value.profiles.length) eligible.push(result.value);
    }
  }
  return { eligible, unavailable };
}

export function GuidedPicker({ locked, children }: {
  locked: boolean; children: (source: Source, profiles: Profile[]) => ReactNode;
}) {
  const { result, retry } = useResource(eligibleSources);
  const [format, setFormat] = useState<Adapter>();
  const [sourceId, setSourceId] = useState('');
  const options = result.state === 'ready' ? result.data.eligible : [];
  const formatSources = options.filter(item => item.source.adapter_type === format);
  const selected = formatSources.find(item => item.source.source_id === sourceId);

  return <section className="panel detail-panel job-create" aria-labelledby="job-input-heading">
    <div className="panel-heading"><h2 id="job-input-heading">Collection setup</h2></div>
    {result.state === 'loading' && <Loading>Checking available sources and profiles…</Loading>}
    {result.state === 'error' && <RequestProblem error={result.error} resource="collection sources" retry={retry} />}
    {result.state === 'ready' && <div className="profile-body">
      {result.data.unavailable > 0 && <div className="availability-note">
        <p role="alert">Some sources are unavailable because their profile versions could not be checked.</p>
        <button type="button" onClick={retry} disabled={locked}>Retry source checks</button>
      </div>}
      {options.length > 0 ? <>
        <fieldset className="format-options" disabled={locked}>
          <legend>1. Select an input format</legend>
          {formats.map(item => {
            const count = options.filter(option => option.source.adapter_type === item.adapter).length;
            return <label className="format-option" key={item.adapter}>
              <input type="radio" name="format" value={item.adapter} disabled={!count} checked={format === item.adapter}
                onChange={() => { setFormat(item.adapter); setSourceId(''); }} />
              <span>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
                <small className="muted">{count ? `${count} eligible ${count === 1 ? 'source' : 'sources'}` : 'Unavailable'}</small>
              </span>
            </label>;
          })}
        </fieldset>
        {format && <div className="profile-form guided-step">
          <label>2. Select a source
            <select value={sourceId} disabled={locked} onChange={event => setSourceId(event.target.value)}>
              <option value="">Choose an authorized source</option>
              {formatSources.map(({ source }) => <option key={source.source_id} value={source.source_id}>{source.source_name}</option>)}
            </select>
          </label>
          {selected && <p><Link to={sourcePath(selected.source.source_id)}>View source access policy</Link></p>}
        </div>}
        {selected && <div className="guided-step">
          <h3>3. Review and start</h3>
          {children(selected.source, selected.profiles)}
        </div>}
      </> : <div className="guided-empty">
        <p role="status"><strong>No eligible sources</strong></p>
        <p>A collection requires a registered source with authorized inputs and at least one approved profile version.</p>
        <Link to={sourcesPath}>Manage sources and profiles</Link>
      </div>}
    </div>}
  </section>;
}
