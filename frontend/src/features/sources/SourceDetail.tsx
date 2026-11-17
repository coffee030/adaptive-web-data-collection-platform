import { BackToCollection } from '../topic-collections/CollectionReturn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Loading, Pagination, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { isLocalOperator, localOperatorHelp } from '../operator/operator';
import { BackToBindings, OperatorLink, OperatorReturn } from '../operator/navigation';
import { useResultReturn } from '../results/resultNavigation';
import { adapterLabels, getSource, listVersions, setSourceAuthorization, sourcesPath, type Source } from './api';
import { profilePath } from '../profiles/api';
import { jobSubmissionPath } from '../collection-jobs/api';
import { topicsPath } from '../topic-collections/api';
import { allowedInputs } from './collectionInput';
import { useResultPage } from '../results/useResultPage';

export function SourcesBreadcrumb() {
  const { state } = useLocation();
  const search = typeof state?.sourcesSearch === 'string' ? state.sourcesSearch : '';
  return <nav className="breadcrumb" aria-label="Breadcrumb">
    <OperatorReturn to={sourcesPath + search}>Sources</OperatorReturn>
    <BackToCollection />
    <BackToBindings />
  </nav>;
}

export function SourceDetail() {
  const { sourceId = '' } = useParams();
  return <SourceWorkspace key={sourceId} sourceId={sourceId} />;
}

function SourceWorkspace({ sourceId }: { sourceId: string }) {
  const { state } = useLocation();
  const load = useCallback((signal: AbortSignal) => getSource(sourceId, signal), [sourceId]);
  const { result, retry } = useResource(load);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [confirmedStatus, setConfirmedStatus] = useState<Source['approval_status']>();
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const review = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLParagraphElement>(null);
  const source = result.state === 'ready' ? result.data : undefined;
  const web = source?.adapter_type === 'web';
  const canChange = web && isLocalOperator();
  const approved = source?.approval_status === 'approved';
  const action = approved ? 'Revoke Source access' : 'Authorize Source access';
  useResultReturn(result.state === 'ready');
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (confirmedStatus) review.current?.focus(); }, [confirmedStatus]);
  useEffect(() => { if (source && (notice || problem)) outcome.current?.focus(); }, [source, notice, problem]);

  async function changeAuthorization() {
    if (!source || !canChange || confirmedStatus !== source.approval_status || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setNotice('');
    setProblem('');
    setBusy(true);
    try {
      const current = await getSource(sourceId, controller.signal);
      if (current.approval_status !== confirmedStatus) {
        setProblem('Source access changed during review. Check the current status before making another change.');
      } else {
        await setSourceAuthorization(sourceId, approved ? 'revoked' : 'approved', controller.signal);
        setNotice('Access change saved. The policy below shows the current Source status.');
      }
    } catch {
      if (!controller.signal.aborted) setProblem('The access change could not be confirmed. Check the reloaded Source status before trying again.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setConfirmedStatus(undefined);
        setBusy(false);
        retry();
      }
    }
  }

  return <>
    <SourcesBreadcrumb />
    <div className="page-heading operator-title"><h1>{source?.source_name ?? 'Source details'}</h1>
      {source && <p>{adapterLabels[source.adapter_type]}</p>}
    </div>
    {result.state === 'loading' && <section className="panel"><Loading>Loading source…</Loading></section>}
    {result.state === 'error' && <section className="panel">
      {result.error.status === 404 || result.error.code === 'invalid_request'
        ? <div className="notice"><p role="alert">Source not found. Check the ID or return to Sources.</p></div>
        : <RequestProblem error={result.error} resource="source details" retry={retry} />}
    </section>}
    {source && <>
      {state?.createdSourceId === sourceId && !notice && !problem && (
        <p className="source-confirmation" role="status">{state.replayed
          ? 'Existing registration recovered. Review its current access status below.'
          : 'Source registered. Review its access policy below.'}</p>
      )}
      {(notice || problem) && <p ref={outcome} tabIndex={-1} className={problem ? 'form-problem profile-feedback' : 'source-confirmation'}
        role={problem ? 'alert' : 'status'}>{problem || notice}</p>}
      <section className="panel operator-sheet" aria-labelledby="access-heading">
        <div className="panel-heading"><h2 id="access-heading">Access policy</h2>
          <Status value={source.approval_status} />
        </div>
        <dl className="source-metadata">
          <div><dt>Permission reference</dt><dd>{source.permission_reference || 'Not recorded'}</dd>
            <dd className="muted">Verify the underlying permission before authorizing access.</dd></div>
          <div><dt>{web ? 'Allowed origins and path prefixes' : 'Allowed dataset IDs'}</dt>
            <dd><PolicyInputs source={source} /></dd>
          </div>
        </dl>
        <details className="operator-disclosure">
          <summary>Technical details</summary>
          <dl className="source-metadata">
            <div><dt>Source ID</dt><dd className="identifier">{source.source_id}</dd></div>
            {web && source.min_request_interval_ms !== undefined &&
              <div><dt>Minimum request interval</dt><dd>{source.min_request_interval_ms} ms</dd></div>}
          </dl>
        </details>
        <div className="operator-action-bar">
          <p>{approved ? 'This Source has approved access. Collection also requires an approved Profile Version.'
            : 'Collection requires source authorization.'}</p>
          {web && !canChange && <p className="muted">{localOperatorHelp}</p>}
          {!web && !approved && <p className="muted">Use the trusted local API to manage CSV source authorization.</p>}
          {canChange && <button ref={trigger} type="button" aria-expanded={!!confirmedStatus} aria-controls="source-access-review"
            disabled={busy || !!confirmedStatus} onClick={() => setConfirmedStatus(source.approval_status)}>
            {approved ? 'Review revocation' : 'Review authorization'}
          </button>}
          <div id="source-access-review" hidden={!confirmedStatus} className="operator-review" ref={review} tabIndex={-1}>
            <h3>{action}</h3>
            <p>Current access is <strong>{source.approval_status}</strong>. {approved
              ? 'Revocation blocks this Source for future collection and makes its Topic Bindings unavailable.'
              : 'Authorization allows the system to use the inputs listed above under the Source policy.'}</p>
            <div className="profile-actions">
              <button className={approved ? 'operator-danger' : 'primary'} type="button" disabled={busy}
                onClick={() => void changeAuthorization()}>{action}</button>
              <button type="button" disabled={busy} onClick={() => {
                setConfirmedStatus(undefined);
                requestAnimationFrame(() => trigger.current?.focus());
              }}>Cancel</button>
              {busy && <span role="status">Saving access status…</span>}
            </div>
          </div>
        </div>
      </section>
      <ProfileVersions source={source} />
    </>}
  </>;
}

function PolicyInputs({ source }: { source: Source }) {
  const web = source.adapter_type === 'web';
  const items = web ? source.allowed_origins : source.allowed_datasets;
  if (!items.length) return <span className="muted">None recorded</span>;
  return <ul className="source-inputs">{items.map(item => {
    const paths = source.allowed_paths?.[item];
    return <li key={item}><code>{item}</code>
      {web && <div className="muted">{paths?.length
        ? <ul>{paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
        : 'All paths on this origin'}</div>}
    </li>;
  })}</ul>;
}

const pageSize = 10;

function ProfileVersions({ source }: { source: Source }) {
  const id = source.source_id;
  const load = useCallback((signal: AbortSignal) => listVersions(id, signal), [id]);
  const { result, retry } = useResource(load);
  const { offset, changePage } = useResultPage();
  const { search, state } = useLocation();
  const profileNavigation = { sourceSearch: search, sourcesSearch: state?.sourcesSearch };
  const canSubmit = source.approval_status === 'approved' && allowedInputs(source).length > 0;
  const versions = result.state === 'ready' ? result.data : [];
  const hasApproved = versions.some(version => version.approval_status === 'approved');
  const hasKeywordProfile = versions.some(version => version.approval_status === 'approved'
    && version.configuration?.adapter_type === 'web' && version.configuration.search);

  return <section className="panel operator-sheet" aria-labelledby="versions-heading">
    <div className="panel-heading">
      <h2 id="versions-heading">Profile versions</h2>
      <OperatorLink className="control" id="source-create-draft" to={profilePath(id, 'new')}
        state={profileNavigation}>Create draft</OperatorLink>
    </div>
    {result.state === 'loading' && <Loading>Loading profile versions…</Loading>}
    {result.state === 'error' && <RequestProblem error={result.error} resource="profile versions" retry={retry} />}
    {result.state === 'ready' && <>
      {versions.length <= offset
        ? <p className="notice" role="status">{offset ? 'This page is empty.' : 'No profile versions registered for this source.'}</p>
        : <table className="operator-ledger version-ledger" role="table">
          <caption className="sr-only">Profile versions. Approval times are in UTC.</caption>
          <thead role="rowgroup"><tr role="row">
            <th scope="col">Version</th><th scope="col">Profile status</th>
            <th scope="col">Approval label</th><th scope="col">Approved (UTC)</th>
          </tr></thead>
          <tbody role="rowgroup">{versions.slice(offset, offset + pageSize).map(version => (
            <tr key={version.profile_version_id} role="row">
              <th scope="row" role="rowheader"><OperatorLink id={'version-' + version.profile_version_id}
                to={profilePath(id, version.profile_version_id)} state={profileNavigation}
                aria-label={`Open profile version ${version.version}`}>Version {version.version}</OperatorLink></th>
              <td role="cell" data-label="Profile status"><Status value={version.approval_status} /></td>
              <td role="cell" data-label="Approval label">{version.approved_by ?? 'Not recorded'}</td>
              <td role="cell" data-label="Approved (UTC)"><Timestamp value={version.approved_at} /></td>
            </tr>
          ))}</tbody>
        </table>}
      {(offset > 0 || versions.length > pageSize) && <Pagination label="Versions" offset={offset} size={pageSize}
        loaded={Math.max(0, versions.length - offset)} change={changePage} />}
      {canSubmit && hasApproved && <div className="operator-action-bar">
        {hasKeywordProfile && <p>A Topic needs its own approved Binding for a keyword-search Profile Version.</p>}
        <div className="profile-actions">
          {hasKeywordProfile && <OperatorLink className="control primary" id="source-topics" to={topicsPath}>Categories and topics</OperatorLink>}
          <Link className="control" to={jobSubmissionPath(id)} state={{ fromSource: id }}>New Collection Job</Link>
        </div>
      </div>}
    </>}
  </section>;
}
