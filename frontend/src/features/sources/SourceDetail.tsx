import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Loading, Pagination, RequestProblem, Status, TableRegion, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { adapterLabels, getSource, listVersions, setSourceAuthorization, sourcesPath } from './api';
import { profilePath } from '../profiles/api';
import { jobSubmissionPath } from '../collection-jobs/api';
import { allowedInputs } from './collectionInput';
import { useResultPage } from '../results/useResultPage';

export function SourcesBreadcrumb() {
  const { state } = useLocation();
  const search = typeof state?.sourcesSearch === 'string' ? state.sourcesSearch : '';
  return <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={{ pathname: sourcesPath, search }}>Sources</Link></nav>;
}

export function SourceDetail() {
  const { sourceId = '' } = useParams();
  const { state } = useLocation();
  const load = useCallback((signal: AbortSignal) => getSource(sourceId, signal), [sourceId]);
  const { result, retry } = useResource(load);
  const source = result.state === 'ready' ? result.data : undefined;
  const web = source?.adapter_type === 'web';
  const policy = web ? source?.allowed_origins : source?.allowed_datasets;
  const [authorizationProblem, setAuthorizationProblem] = useState('');
  const [savingAuthorization, setSavingAuthorization] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [sourceId]);
  const localOperator = __LOCAL_PROFILE_APPROVAL__ && window.location.protocol === 'http:'
    && window.location.hostname === '127.0.0.1';

  async function changeAuthorization(status: 'approved' | 'revoked') {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setAuthorizationProblem('');
    setSavingAuthorization(true);
    try {
      await setSourceAuthorization(sourceId, status, controller.signal);
      if (!controller.signal.aborted) retry();
    } catch {
      if (!controller.signal.aborted) setAuthorizationProblem('Could not confirm Source authorization. Reload the Source before trying again.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setSavingAuthorization(false);
    }
  }

  return (
    <>
      <SourcesBreadcrumb />
      <div className="page-heading source-heading"><h1>{source?.source_name ?? 'Source details'}</h1></div>
      {state?.createdSourceId === sourceId && source && (
        <p className="source-confirmation" role="status">Source registered. Review its access policy below.</p>
      )}
      {result.state === 'loading' && <section className="panel"><Loading>Loading source…</Loading></section>}
      {result.state === 'error' && (
        <section className="panel">
          {result.error.status === 404 || result.error.code === 'invalid_request'
            ? <div className="notice"><p role="alert">Source not found. Check the ID or return to Sources.</p></div>
            : <RequestProblem error={result.error} resource="source details" retry={retry} />}
        </section>
      )}
      {source && <>
        <section className="panel detail-panel" aria-labelledby="access-heading">
          <div className="panel-heading"><h2 id="access-heading">Access policy</h2></div>
          <dl className="source-metadata">
            <div><dt>Access authorization</dt><dd><Status value={source.approval_status} /></dd>
              {source.approval_status !== 'approved' && <dd className="muted">Collection requires source authorization.</dd>}
              {web && localOperator && <dd><button type="button" disabled={savingAuthorization}
                onClick={() => void changeAuthorization(source.approval_status === 'approved' ? 'revoked' : 'approved')}>
                {source.approval_status === 'approved' ? 'Revoke Source access' : 'Authorize Source access'}
              </button></dd>}
              {authorizationProblem && <dd role="alert">{authorizationProblem}</dd>}
            </div>
            <div><dt>Adapter</dt><dd>{adapterLabels[source.adapter_type]}</dd></div>
            <div><dt>Source ID</dt><dd className="identifier">{source.source_id}</dd></div>
            <div><dt>Permission reference</dt><dd>{source.permission_reference || 'Not recorded'}</dd></div>
            <div className="source-policy"><dt>{web ? 'Allowed origins' : 'Allowed dataset IDs'}</dt>
              <dd>{policy?.length ? <ul>{policy.map((item, index) => (
                <li className="identifier" key={index}>{item}{source.allowed_paths?.[item] &&
                  <ul>{source.allowed_paths[item].map(path => <li key={path}>{path}</li>)}</ul>}</li>
              ))}</ul> : <span className="muted">None recorded</span>}</dd>
            </div>
            {web && source.min_request_interval_ms !== undefined &&
              <div><dt>Minimum request interval</dt><dd>{source.min_request_interval_ms} ms</dd></div>}
          </dl>
        </section>
        <ProfileVersions key={source.source_id} id={source.source_id}
          canSubmit={source.approval_status === 'approved' && allowedInputs(source).length > 0} />
      </>}
    </>
  );
}

const pageSize = 10;

function ProfileVersions({ id, canSubmit }: { id: string; canSubmit: boolean }) {
  const load = useCallback((signal: AbortSignal) => listVersions(id, signal), [id]);
  const { result, retry } = useResource(load);
  const { offset, changePage } = useResultPage();
  const { search, state } = useLocation();

  return (
    <section className="panel detail-panel" aria-labelledby="versions-heading">
      <div className="panel-heading">
        <h2 id="versions-heading">Profile versions</h2>
        <div className="profile-actions">
          <Link className="control" to={profilePath(id, 'new')}
            state={{ sourceSearch: search, sourcesSearch: state?.sourcesSearch }}>Create draft</Link>
          {canSubmit && result.state === 'ready' && result.data.some(version => version.approval_status === 'approved') &&
            <Link className="control" to={jobSubmissionPath(id)} state={{ fromSource: id }}>New Collection Job</Link>}
        </div>
      </div>
      {result.state === 'loading' && <Loading>Loading profile versions…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="profile versions"
        retry={retry} />}
      {result.state === 'ready' && (result.data.length <= offset
        ? <>
          <p className="notice" role="status">{offset ? 'This page is empty.' : 'No profile versions registered for this source.'}</p>
          {offset > 0 && <Pagination label="Versions" offset={offset} size={pageSize} loaded={0} change={changePage} />}
        </>
        : <>
          <TableRegion label="Profile versions table, scroll horizontally for more columns">
            <table className="versions-table">
              <caption className="sr-only">Profile versions. Approval times are in UTC.</caption>
              <thead><tr>
                <th scope="col">Version</th><th scope="col">Profile status</th><th scope="col">Version ID</th>
                <th scope="col">Configuration hash</th><th scope="col">Approved (UTC)</th><th scope="col">Approver</th>
              </tr></thead>
              <tbody>{result.data.slice(offset, offset + pageSize).map(version => (
                <tr key={version.profile_version_id}>
                  <th scope="row"><Link to={profilePath(id, version.profile_version_id)} state={{ sourceSearch: search, sourcesSearch: state?.sourcesSearch }}
                    aria-label={`Open profile version ${version.version}`}>{version.version}</Link></th>
                  <td><Status value={version.approval_status} /></td>
                  <td className="identifier">{version.profile_version_id}</td>
                  <td className="identifier">{version.config_hash}</td>
                  <td><Timestamp value={version.approved_at} /></td>
                  <td>{version.approved_by ?? 'Not recorded'}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableRegion>
          <Pagination label="Versions" offset={offset} size={pageSize}
            loaded={Math.max(0, result.data.length - offset)} change={changePage} />
        </>)}
    </section>
  );
}
