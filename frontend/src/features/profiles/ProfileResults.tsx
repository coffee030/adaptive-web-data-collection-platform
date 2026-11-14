import { TableRegion, Timestamp } from '../../components/feedback';
import type { Candidate, Configuration, Rejection, Report } from './api';

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
  return <section className="profile-result" aria-label="Validation report">
    <h3 aria-labelledby="validation-outcome"><span id="validation-outcome" role="status">
      {report.passed ? 'Validation passed' : 'Validation failed'}
    </span></h3>
    <dl className="source-metadata profile-result-meta">
      <div><dt>Report ID</dt><dd className="identifier">{report.report_id}</dd></div>
      <div><dt>Configuration hash</dt><dd className="identifier">{report.config_hash}</dd></div>
      <div><dt>Validated (UTC)</dt><dd><Timestamp value={report.validated_at} /></dd></div>
      <div><dt>Result counts</dt><dd>Valid {report.valid_count} · Invalid {report.invalid_count} · Duplicates {report.duplicate_count}</dd></div>
      {report.sample_location && <div><dt>Sample location</dt><dd className="identifier">{report.sample_location}</dd></div>}
      {report.sample_hash && <div><dt>Sample hash</dt><dd className="identifier">{report.sample_hash}</dd></div>}
    </dl>
    {report.error && <p role="alert">{report.error.message} <code>{report.error.code}</code></p>}
    {report.invalid.length > 0 && <>
      <h4>Invalid records</h4>
      <ul className="profile-problems">{report.invalid.slice(0, 20).map((item, index) =>
        <li key={index}><strong>{position(item)}</strong><Problems problems={item.problems} /></li>)}</ul>
      {report.invalid.length > 20 && <p>Showing the first 20 of {report.invalid.length} rejected records.</p>}
    </>}
  </section>;
}

export function ConfigurationSummary({ configuration: config }: { configuration: Configuration }) {
  const web = config.adapter_type === 'web';
  return <>
    <dl className="source-metadata">
      <div><dt>Record type</dt><dd>{config.record_schema.record_type}</dd></div>
      <div><dt>Identity field</dt><dd>{config.record_schema.identity_field ?? 'None'}</dd></div>
      <div><dt>Configuration schema</dt><dd>{config.config_schema_version}</dd></div>
      <div><dt>Record schema</dt><dd>{config.record_schema.schema_version}</dd></div>
      {web && <div className="source-policy"><dt>Item selector ({config.selector_type})</dt>
        <dd><code>{config.item_selector}</code></dd></div>}
    </dl>
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
