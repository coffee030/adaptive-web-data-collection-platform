import { TableRegion, Timestamp } from '../../components/feedback';
import type { Candidate, Configuration, Rejection, Report } from './api';
import { renderingProblems } from './api';

function position(item: Rejection) {
  return `${item.source_position.kind === 'csv_row' ? 'CSV row' : 'HTML item'} ${item.source_position.index}`;
}

function Problems({ problems }: Pick<Rejection, 'problems'>) {
  return problems.length ? <ul className="profile-problems">{problems.map((problem, index) => (
    <li key={index}>{problem.field && <strong>{problem.field}: </strong>}{problem.message} <code>{problem.code}</code></li>
  ))}</ul> : <span className="muted">None reported</span>;
}

export function PreviewResults({ candidates, configuration }: { candidates: Candidate[]; configuration: Configuration }) {
  if (!candidates.length) return <p role="status">No candidate records were returned.</p>;
  return <TableRegion label="Preview candidates table">
    <table className="profile-table">
      <caption>Preview candidates ({candidates.length} of up to 5)</caption>
      <thead><tr><th scope="col">Source position</th><th scope="col">Extracted fields</th><th scope="col">Problems</th></tr></thead>
      <tbody>{candidates.map((item, index) => <tr key={index}>
        <th scope="row">{position(item)}</th>
        <td><dl className="profile-values">{configuration.record_schema.fields.map(field => {
          const value = Object.hasOwn(item.payload, field.name) ? item.payload[field.name] : undefined;
          const output = value === undefined ? 'Missing' : JSON.stringify(value);
          return <div key={field.name}><dt>{field.name}</dt><dd>{output && output.length > 256
            ? output.slice(0, 256) + '…' : output}</dd></div>;
        })}</dl></td>
        <td><Problems problems={item.problems} /></td>
      </tr>)}</tbody>
    </table>
  </TableRegion>;
}

export function ValidationResult({ report }: { report: Report }) {
  return <section className="profile-result" aria-label="Validation report" data-passed={report.passed}>
    <h3 aria-labelledby="validation-outcome"><span id="validation-outcome" role="status">
      {report.passed ? 'Validation passed' : 'Validation failed'}
    </span></h3>
    <dl className="source-metadata profile-result-meta">
      <div><dt>Validated (UTC)</dt><dd><Timestamp value={report.validated_at} /></dd></div>
      <div><dt>Result counts</dt><dd>Valid {report.valid_count} · Invalid {report.invalid_count} · Duplicates {report.duplicate_count}</dd></div>
      {report.sample_location && <div><dt>Sample location</dt><dd className="identifier">{report.sample_location}</dd></div>}
    </dl>
    {report.error && <p role="alert">{renderingProblems[report.error.code] ?? report.error.message} <code>{report.error.code}</code></p>}
    {report.invalid.length > 0 && <>
      <h4>Invalid records</h4>
      <ul className="profile-problems">{report.invalid.slice(0, 20).map((item, index) =>
        <li key={index}><strong>{position(item)}</strong><Problems problems={item.problems} /></li>)}</ul>
      {report.invalid.length > 20 && <p>Showing the first 20 of {report.invalid.length} rejected records.</p>}
    </>}
    <details className="profile-options">
      <summary>Report technical details</summary>
      <dl className="source-metadata profile-result-meta">
        <div><dt>Report ID</dt><dd className="identifier">{report.report_id}</dd></div>
        <div><dt>Configuration hash</dt><dd className="identifier">{report.config_hash}</dd></div>
        {report.sample_hash && <div><dt>Sample hash</dt><dd className="identifier">{report.sample_hash}</dd></div>}
      </dl>
    </details>
  </section>;
}

export function ConfigurationSummary({ configuration: config }: { configuration: Configuration }) {
  const web = config.adapter_type === 'web';
  const search = web ? config.search : undefined;
  return <>
    <dl className="source-metadata">
      <div><dt>Record type</dt><dd>{config.record_schema.record_type}</dd></div>
      <div><dt>Identity field</dt><dd>{config.record_schema.identity_field ?? 'None'}</dd></div>
      {web && <div className="source-policy"><dt>Item selector ({config.selector_type})</dt>
        <dd><code>{config.item_selector}</code></dd></div>}
      {web && config.rendering && <>
        <div><dt>Collection mode</dt><dd>Rendered document</dd></div>
        <div className="source-policy"><dt>Ready element (CSS)</dt><dd><code>{config.rendering.ready_selector}</code></dd></div>
        <div><dt>Maximum wait</dt><dd>{config.rendering.timeout_ms.toLocaleString('en-GB')} ms</dd></div>
      </>}
      {web && config.pagination && <>
        <div className="source-policy"><dt>Next-link selector ({config.selector_type})</dt>
          <dd><code>{config.pagination.next_link_selector}</code></dd></div>
        <div><dt>Maximum HTML pages</dt><dd>{config.pagination.max_pages}</dd></div>
      </>}
      {search && <>
        <div className="source-policy"><dt>Keyword search</dt><dd><code>{search.origin}{search.path}</code></dd></div>
        <div><dt>Keyword parameter</dt><dd><code>{search.keyword_parameter}</code></dd></div>
        <div><dt>Search result item selector</dt><dd><code>{search.result_item_selector}</code></dd></div>
        <div><dt>Detail link selector</dt><dd><code>{search.detail_link_selector}</code></dd></div>
        {search.pagination && <div><dt>Search next-link selector</dt><dd><code>{search.pagination.next_link_selector}</code></dd></div>}
        <div><dt>Maximum search pages</dt><dd>{search.pagination?.max_pages ?? 1}</dd></div>
        <div><dt>Maximum detail pages</dt><dd>{search.max_detail_pages}</dd></div>
        <div><dt>Maximum HTTP requests</dt><dd>{search.max_requests}</dd></div>
      </>}
      {web && config.article && <div className="source-policy">
        <dt>Article mapping</dt>
        <dd>{Object.entries(config.article).filter(([, field]) => field).map(([common, field]) =>
          <div key={common}><code>{common}</code> → <code>{field}</code></div>)}</dd>
      </div>}
    </dl>
    <details className="operator-disclosure">
      <summary>Technical configuration</summary>
      <dl className="source-metadata">
        <div><dt>Configuration schema</dt><dd>{config.config_schema_version}</dd></div>
        <div><dt>Record schema</dt><dd>{config.record_schema.schema_version}</dd></div>
        {web && config.rendering && <div><dt>Reviewed inline script SHA-256 hashes</dt>
          <dd className="identifier">{config.rendering.script_sha256.map(hash => <div key={hash}><code>{hash}</code></div>)}</dd></div>}
        {search && <>
          <div><dt>Request timeout</dt><dd>{search.timeout_seconds ?? 2} seconds</dd></div>
          <div><dt>Collection time budget</dt><dd>{search.max_seconds ?? 45} seconds</dd></div>
          <div><dt>Response size limit</dt><dd>{search.max_body_bytes ?? 1048576} bytes</dd></div>
          <div><dt>Maximum redirects per document</dt><dd>{search.max_redirects ?? 2}</dd></div>
          <div><dt>Maximum execution attempts</dt><dd>{search.max_attempts ?? 3}</dd></div>
        </>}
      </dl>
    </details>
    <TableRegion label="Configuration fields table">
      <table className="profile-table">
        <caption>Output fields</caption>
        <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Required</th>
          <th scope="col">{web ? 'Extraction' : 'CSV header'}</th></tr></thead>
        <tbody>{config.record_schema.fields.map(field => {
          const mapping = web ? config.fields.find(item => item.name === field.name) : undefined;
          return <tr key={field.name}>
            <th scope="row">{field.name}</th><td>{field.value_type}</td><td>{field.required ? 'Yes' : 'No'}</td>
            <td>{mapping && web ? <>
              <code>{mapping.selector}</code>
              <div>{mapping.selector_type ?? config.selector_type} · {mapping.mode}
                {mapping.attribute && <> · <code>{mapping.attribute}</code></>}
                {mapping.resolve_url && ' · Resolves relative URLs'}</div>
            </> : !web && config.columns.find(item => item.name === field.name)?.column}</td>
          </tr>;
        })}</tbody>
      </table>
    </TableRegion>
  </>;
}
