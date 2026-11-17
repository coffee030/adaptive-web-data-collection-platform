import { Link } from 'react-router';
import { profilePath } from '../profiles/api';
import { sourcePath } from '../sources/api';
import { topicsPath, type Binding } from './api';
import { maxBindings, samePin, type CollectionSelection } from './collectionDraft';
import { collectionReturnState } from './CollectionReturn';

export function SourceChoices({ rows, selected, onChange, onInspect }: {
  rows: Binding[];
  selected: Binding[];
  onChange: (rows: Binding[]) => void;
  onInspect: (id: string) => void;
}) {
  return <ul className="collection-sources" role="list">
    {rows.map(row => {
      const checked = selected.some(binding => samePin(binding, row));
      const sourceLinkId = 'inspect-source-' + row.id;
      const profileLinkId = 'inspect-profile-' + row.id;
      return <li key={row.id} data-checked={checked}>
        <label className="collection-source-choice">
          <input type="checkbox" checked={checked} disabled={!checked && selected.length >= maxBindings}
            onChange={() => onChange(checked ? selected.filter(binding => binding.id !== row.id) : [...selected, row])} />
          <span><strong>{row.source_name}</strong><small>Approved profile · Version {row.profile_version}</small></span>
        </label>
        <div className="collection-source-links">
          <Link id={sourceLinkId} to={sourcePath(row.source_id)} state={collectionReturnState}
            aria-label={'Source details for ' + row.source_name} onClick={() => onInspect(sourceLinkId)}>Source details</Link>
          <Link id={profileLinkId} to={profilePath(row.source_id, row.profile_version_id)} state={collectionReturnState}
            aria-label={`Profile version ${row.profile_version} for ${row.source_name}`}
            onClick={() => onInspect(profileLinkId)}>Profile version</Link>
        </div>
      </li>;
    })}
  </ul>;
}

export function TopicBindingSetup({ topicId }: { topicId: string }) {
  return <div className="catalog-empty">
    <strong>No eligible sources for this topic</strong>
    <p>Collection can begin once an authorized source has an approved profile bound to this topic.</p>
    <Link to={topicsPath + '/' + encodeURIComponent(topicId)} state={collectionReturnState}>View topic bindings</Link>
  </div>;
}

export function CollectionSummary({ selection }: { selection: CollectionSelection }) {
  const { category, topic, keyword, sources } = selection;
  return <div className="collection-summary">
    <dl>
      <div><dt>Category</dt><dd>{category}</dd></div>
      <div><dt>Topic</dt><dd>{topic}</dd></div>
      <div><dt>Keyword</dt><dd>{keyword}</dd></div>
    </dl>
    <div>
      <h3>{sources.length} selected {sources.length === 1 ? 'source' : 'sources'}</h3>
      <ul role="list">{sources.map(row =>
        <li key={row.id}>{row.source_name} <span className="muted review-version">· Version {row.profile_version}</span></li>,
      )}</ul>
      <p className="collection-job-count">{sources.length} {sources.length === 1 ? 'job' : 'jobs'} will search the selected sources using the approved profiles above.</p>
    </div>
  </div>;
}
