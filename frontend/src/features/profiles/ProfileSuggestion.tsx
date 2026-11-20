import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { suggestProfile, type Schema, type SuggestionResult } from './api';
import { applySuggestion, suggestionSchema, type Draft } from './configuration';

const outcomes: Record<SuggestionResult['outcome'], string> = {
  usable: 'Suggestion ready for review',
  partial: 'Mapping needs edits',
  needs_examples: 'Permitted examples needed',
  unsupported: 'Search could not be represented',
  denied: 'Access denied',
  budget_exhausted: 'Discovery budget reached',
  transient_failure: 'Discovery interrupted',
};
const stages: Record<SuggestionResult['stage'], string> = {
  entry: 'Entry check', robots: 'Robots policy', homepage: 'Homepage',
  navigation: 'Search navigation', results: 'Results', detail: 'Representative detail', mapping: 'Mapping',
};
const requestStates: Record<SuggestionResult['requests'][number]['state'], string> = {
  denied_before_send: 'Denied before sending', reserved_unsent: 'Reserved, unsent', transport_attempt: 'Attempted',
};

interface Props {
  sourceId: string;
  draft: Draft;
  dirty: boolean;
  disabled: boolean;
  change: (draft: Draft, dirty: boolean) => void;
}

export function ProfileSuggestion({ sourceId, draft, dirty, disabled, change }: Props) {
  const [mode, setMode] = useState<'homepage' | 'examples'>('homepage');
  const [keyword, setKeyword] = useState('');
  const [homepage, setHomepage] = useState('');
  const [results, setResults] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<{ result: SuggestionResult; draft: Draft; schema?: Schema }>();
  const [undo, setUndo] = useState<{ before: Draft; after: Draft; dirty: boolean }>();
  const inputs = useRef(0);
  const currentDraft = useRef(draft);
  const active = useRef<AbortController | null>(null);
  currentDraft.current = draft;
  useEffect(() => () => active.current?.abort(), []);

  function update(changeInput: () => void) {
    inputs.current += 1;
    setResponse(undefined);
    setError('');
    changeInput();
  }

  async function discover() {
    if (active.current || disabled) return;
    setError('');
    setResponse(undefined);
    let schema: Schema | undefined;
    try {
      schema = suggestionSchema(draft);
    } catch (issue) {
      setError((issue as Error).message);
      return;
    }
    const controller = new AbortController();
    const revision = inputs.current;
    active.current = controller;
    setBusy(true);
    try {
      const result = await suggestProfile(sourceId, {
        keyword: keyword.trim(), record_schema: schema,
        ...(mode === 'homepage' ? { mode, homepage_url: homepage.trim() }
          : { mode, results_url: results.trim(), detail_url: detail.trim() }),
      }, controller.signal);
      if (!controller.signal.aborted && inputs.current === revision && currentDraft.current === draft) {
        setResponse({ result, draft, schema });
      }
    } catch (issue) {
      if (controller.signal.aborted || inputs.current !== revision || currentDraft.current !== draft) return;
      setError(issue instanceof ApiError && issue.kind === 'timeout'
        ? 'The Dashboard timed out waiting for discovery. Start a new attempt when ready.'
        : 'Could not get a suggestion. Check the Source and the supplied URLs before trying again.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const result = response?.draft === draft ? response.result : undefined;
  const proposal = result?.proposal;
  const fallback = mode === 'homepage' && result && (
    result.outcome === 'needs_examples' || result.outcome === 'budget_exhausted'
    || (result.code === 'destination_denied' && result.stage === 'entry')
  );
  return <details className="profile-options profile-suggestion">
    <summary>Get a profile suggestion</summary>
    <form className="profile-form" onSubmit={event => { event.preventDefault(); void discover(); }}>
      <div className="profile-grid">
        <label>Start from
          <select value={mode} onChange={event => update(() => setMode(event.target.value === 'examples' ? 'examples' : 'homepage'))}>
            <option value="homepage">Permitted homepage</option>
            <option value="examples">Permitted results and detail URLs</option>
          </select>
        </label>
        <label>Discovery keyword
          <input required maxLength={128} value={keyword} onChange={event => update(() => setKeyword(event.target.value))} />
        </label>
        {mode === 'homepage' ? <label>Homepage URL
          <input type="url" required maxLength={2048} value={homepage} onChange={event => update(() => setHomepage(event.target.value))} />
        </label> : <>
          <label>Results URL
            <input type="url" required maxLength={2048} value={results} onChange={event => update(() => setResults(event.target.value))} />
          </label>
          <label>Representative detail URL
            <input type="url" required maxLength={2048} value={detail} onChange={event => update(() => setDetail(event.target.value))} />
          </label>
        </>}
      </div>
      <div className="profile-actions">
        <button type="submit" disabled={busy || disabled || !keyword.trim()}>{busy ? 'Finding a suggestion…' : 'Find suggestion'}</button>
      </div>
      <div role="status">
        {busy && 'Checking the Source and reading permitted pages…'}
        {result && <><strong>{outcomes[result.outcome]}</strong><p>{result.reason}</p></>}
      </div>
      {error && <p role="alert">{error}</p>}
      {result && <div className="profile-form">
        <p>{stages[result.stage]} · {result.actual_attempts} outbound attempts · {result.reserved_requests} reserved
          {result.limits && <> · cap of {result.limits.max_requests} requests in {result.limits.max_seconds} seconds</>}
        </p>
        {result.retry_after_seconds !== null && <p>Origin cooldown reported at {result.retry_after_seconds} seconds.</p>}
        {result.limits && <details className="profile-options">
          <summary>Request limits and activity</summary>
          <p>{result.limits.policy === 'public_conservative' ? 'Conservative public Source limits' : 'Controlled fixture limits'}
            {result.limits.reviewed_profile_limits && ' with reviewed Profile limits applied'}.
            {' '}{result.limits.max_body_bytes.toLocaleString()} bytes per response and{' '}
            {result.limits.max_total_body_bytes.toLocaleString()} bytes total.
            {' '}Up to {result.limits.timeout_seconds} seconds per request and at least {result.limits.min_request_interval_ms} ms between requests.
          </p>
          {result.requests.length > 0 && <ol>{result.requests.map((entry, index) =>
            <li key={index}>{stages[entry.stage]} · {requestStates[entry.state]}</li>)}</ol>}
        </details>}
        {fallback && <div><button type="button" onClick={() => update(() => setMode('examples'))}>Use permitted examples</button></div>}
        {proposal && <>
          <dl className="suggestion-mapping">
            <dt>Search path and keyword parameter</dt><dd><code>{proposal.search.path}</code> · <code>{proposal.search.keyword_parameter}</code></dd>
            <dt>Result item</dt><dd><code>{proposal.search.result_item_selector}</code></dd>
            <dt>Detail link per result</dt><dd><code>{proposal.search.detail_link_selector}</code></dd>
            <dt>Selected listing text</dt><dd>{proposal.listing_sample}</dd>
            <dt>Detail item</dt><dd>{proposal.item_selector ? <code>{proposal.item_selector}</code> : 'Unresolved'}</dd>
            <dt>Record identity</dt><dd>{proposal.record_schema.identity_field ?? 'Full record'}</dd>
            {proposal.fields.map(field => <div key={field.name}>
              <dt>{field.name}</dt><dd>{field.mapping ? <code>{field.mapping.selector}</code> : 'Unresolved'}
                {field.sample !== null && <> · Sample <strong>{String(field.sample)}</strong></>}
                <p>{field.reason}</p>
              </dd>
            </div>)}
          </dl>
          {dirty && <p>Applying replaces discovery-related selectors in the editor. You can undo the change before making further edits.</p>}
          <div><button type="button" disabled={disabled} onClick={() => {
            const after = applySuggestion(draft, proposal, response?.schema);
            setUndo({ before: draft, after, dirty });
            change(after, true);
          }}>Apply to editor</button></div>
        </>}
      </div>}
      {undo?.after === draft && <div className="profile-actions">
        <p role="status">Suggestion applied. Review the editable configuration before creating a draft.</p>
        <button type="button" disabled={disabled} onClick={() => { change(undo.before, undo.dirty); setUndo(undefined); }}>Undo suggestion</button>
      </div>}
    </form>
  </details>;
}
