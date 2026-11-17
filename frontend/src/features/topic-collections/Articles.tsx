import { useCallback, useEffect, useRef } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { TableRegion, Timestamp } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath, sameId } from '../collection-jobs/api';
import { profilePath } from '../profiles/api';
import { evidenceDetailPath, recordPath, recordsForRequest, recordsPath } from '../results/api';
import { JsonViewer } from '../results/JsonViewer';
import { webLocation } from '../results/presentation';
import {
  contextFrom, ContextLink, readId, readOffset, rememberPosition, ReturnLink, returnLabel, useResultReturn,
} from '../results/resultNavigation';
import { sourcePath } from '../sources/api';
import {
  articlePath, articlesPath, requestArticlesPath, requestPath, type ArticleDetail, type ArticleSummary,
  type ArticleVersion, type Observation, type ObservationDetail, type VersionInfo,
} from './api';
import { Page, Resource } from './support';
import './topic-collections.css';

export function ArticlesPage() {
  const [search, setSearch] = useSearchParams();
  const requestId = readId(search, 'request_id') || undefined;
  const previous = contextFrom('?' + search);
  const invalidScope = search.has('request_id') && !requestId;
  const paging = {
    offset: readOffset(search),
    change: (offset: number) => {
      const params = new URLSearchParams(search);
      if (offset) params.set('offset', String(offset));
      else params.delete('offset');
      setSearch(params);
    },
  };
  useResultReturn(true);
  return <>
    <nav className="breadcrumb article-breadcrumb" aria-label="Breadcrumb">
      <ReturnLink to={previous || (requestId ? recordsForRequest(requestId) : recordsPath)}>Data Explorer</ReturnLink>
      {requestId && <Link to={requestPath(requestId)}>Collection request</Link>}
    </nav>
    <div className="page-heading detail-heading"><h1>Articles</h1>
      {requestId && <Link className="control" to={articlesPath}>Browse all articles</Link>}
    </div>
    {invalidScope ? <div className="notice" role="alert">
      <strong>Invalid Collection Request ID</strong>
      <p><Link to={articlesPath}>Browse all articles</Link></p>
    </div> : <ArticleList key={requestId ?? 'all'} requestId={requestId} paging={paging} />}
  </>;
}

export function ArticleList({ requestId, revision, paging }: {
  requestId?: string; revision?: number; paging?: { offset: number; change: (offset: number) => void };
}) {
  return <section className="panel detail-panel" aria-label={requestId ? 'Articles observed by this request' : 'Latest articles'}>
    {requestId && <div className="panel-heading"><h2>Articles observed in this run</h2></div>}
    {requestId && <p className="notice muted">
      This request determines which articles appear. Titles, versions, and observation times show the latest capture across all collections.
    </p>}
    <Page<ArticleSummary> path={articlesPath} label="Articles" requestId={requestId} revision={revision} paging={paging}
      empty={requestId ? 'No articles have been observed in this run.' : 'Articles appear after a job publishes data from a profile with article mapping.'}>
      {rows => <TableRegion label="Latest article content">
        <table>
          <thead><tr><th scope="col">Latest title</th><th scope="col">Source</th>
            <th scope="col">Current version</th><th scope="col">Latest observation (UTC)</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <th scope="row" className="collection-text"><ContextLink id={'article-' + row.id} to={requestId
              ? requestArticlesPath(requestId, articlePath(row.id)) : articlePath(row.id)}>{row.title}</ContextLink></th>
            <td><Link to={sourcePath(row.source_id)}>{row.source_name}</Link></td>
            <td>{row.version}</td><td><Timestamp value={row.captured_at} /></td>
          </tr>)}</tbody>
        </table>
      </TableRegion>}
    </Page>
  </section>;
}

export function ArticlePage() {
  const { articleId = '' } = useParams();
  return <ArticleWorkspace key={articleId} id={articleId} />;
}

function ArticleWorkspace({ id }: { id: string }) {
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const path = articlePath(id);
  const requestId = readId(search, 'request_id');
  const versionId = readId(search, 'version_id');
  const recordId = readId(search, 'observation_id');
  const load = useCallback((signal: AbortSignal) => apiGet<ArticleDetail>(path, signal), [path]);
  const state = useResource(load);
  const previous = contextFrom(location.search);
  const versionHeading = useRef<HTMLHeadingElement>(null);
  const observationHeading = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<'version_id' | 'observation_id' | undefined>(undefined);
  useResultReturn(state.result.state === 'ready');

  function select(key: 'version_id' | 'observation_id', id: string, trigger: HTMLElement, toggle = true) {
    const params = new URLSearchParams(search);
    if (trigger.id) rememberPosition(location.key, trigger.id);
    if (params.get(key) === id) {
      if (toggle) params.delete(key);
      else {
        versionHeading.current?.focus();
        return;
      }
    }
    else {
      params.set(key, id);
      focusNext.current = key;
    }
    setSearch(params, { preventScrollReset: true });
  }

  useEffect(() => {
    const focus = focusNext.current;
    focusNext.current = undefined;
    if (focus === 'version_id') versionHeading.current?.focus();
    if (focus === 'observation_id') observationHeading.current?.focus();
  }, [versionId, recordId]);

  function page(key: 'version_offset' | 'observation_offset') {
    return {
      offset: readOffset(search, key),
      change: (offset: number) => {
        const params = new URLSearchParams(search);
        if (offset) params.set(key, String(offset));
        else params.delete(key);
        (key === 'version_offset' ? versionHeading : observationHeading).current?.focus({ preventScroll: true });
        setSearch(params, { preventScrollReset: true });
      },
    };
  }

  const fallback = requestId ? requestArticlesPath(requestId) : articlesPath;
  return <>
    <nav className="breadcrumb article-breadcrumb" aria-label="Breadcrumb">
      <ReturnLink to={previous || fallback}>{previous ? returnLabel(previous) : 'Back to Articles'}</ReturnLink>
      {requestId && <Link to={requestPath(requestId)}>Collection request</Link>}
    </nav>
    {search.has('request_id') && !requestId && <div className="notice" role="alert">
      <strong>Invalid Collection Request ID</strong>
      <p><Link to={path}>Open article without a request scope</Link></p>
    </div>}
    {(!search.has('request_id') || requestId) && <Resource label="article" state={state}>{article => <>
      <div className="page-heading collection-text article-heading">
        <h1>Article History</h1>
        <p><Link to={sourcePath(article.source_id)}>{article.source_name}</Link></p>
      </div>
      <section className="panel history-panel" aria-labelledby="latest-article">
        <div className="history-latest">
          <p className="history-kicker" id="latest-article">Latest content across all collections</p>
          <h2>{article.title}</h2>
          <p className="muted">Version {article.version} · Observed <Timestamp value={article.captured_at} /> UTC</p>
          {requestId && <p className="history-scope-note">
            <a href="#article-observations">See observations from this request</a> for the content it captured.
          </p>}
          <Content version={article.latest_version} />
          <p className="identifier muted">{webLocation(article.url)}</p>
          <Lineage item={article.latest_observation} sourceId={article.source_id} prefix="latest" />
        </div>
      </section>
      <section className="panel history-panel" aria-labelledby="article-versions">
        <div className="panel-heading">
          <h2 id="article-versions" ref={versionHeading} tabIndex={-1}>Content versions</h2>
          <span className="muted timezone">Stored across collections</span>
        </div>
        {versionId && <SelectedVersion path={path} id={versionId} />}
        {search.has('version_id') && !versionId && <p className="notice" role="alert">Invalid Content Version ID.</p>}
        <Page<VersionInfo> path={path + '/versions'} label="Versions" empty="No content versions." paging={page('version_offset')}>
          {rows => <ol className="history-register" aria-label="Content version list">
            {rows.map(row => <li key={row.id} data-selected={sameId(versionId, row.id)}>
              <strong>Version {row.version}</strong>
              <span className="muted"><Timestamp value={row.created_at} /> UTC</span>
              <button id={'version-' + row.id} type="button" aria-pressed={sameId(versionId, row.id)}
                onClick={event => select('version_id', row.id, event.currentTarget)}>View version {row.version}</button>
            </li>)}
          </ol>}
        </Page>
      </section>
      <section className="panel history-panel" aria-labelledby="article-observations">
        <div className="panel-heading">
          <div><h2 id="article-observations" ref={observationHeading} tabIndex={-1}>Observation history</h2>
            <p className="muted timezone">{requestId ? 'Observations from this collection request' : 'Observations from all collections'}</p>
          </div>
          {requestId && <Link to={path}>Show all observations</Link>}
        </div>
        {recordId && <SelectedObservation sourceId={article.source_id} path={path} id={recordId} requestId={requestId}
          selectVersion={(id, trigger) => select('version_id', id, trigger, false)} />}
        {search.has('observation_id') && !recordId && <p className="notice" role="alert">Invalid Observation Record ID.</p>}
        <Page<Observation> path={path + '/observations'} label="Observations" requestId={requestId}
          paging={page('observation_offset')}
          empty={requestId ? 'No observations for this article in the selected request.' : 'No observations.'}>
          {rows => <ol className="history-register observation-register" aria-label="Observation list">
            {rows.map(row => <li key={row.record_id} data-selected={sameId(recordId, row.record_id)}>
              <div><Timestamp value={row.captured_at} /> <span className="muted timezone">UTC</span></div>
              <div className="profile-actions">
                <ContextLink id={'observation-record-' + row.record_id} to={recordPath(row.record_id)}>Record</ContextLink>
                <ContextLink id={'observation-evidence-' + row.record_id} to={evidenceDetailPath(row.evidence_id, row.request_id)}>Evidence</ContextLink>
              </div>
              <button id={'observation-' + row.record_id} type="button" aria-pressed={sameId(recordId, row.record_id)}
                onClick={event => select('observation_id', row.record_id, event.currentTarget)}>
                Inspect observation
              </button>
            </li>)}
          </ol>}
        </Page>
      </section>
    </>}</Resource>}
  </>;
}

function SelectedVersion({ path, id }: { path: string; id: string }) {
  const load = useCallback((signal: AbortSignal) => apiGet<ArticleVersion>(`${path}/versions/${id}`, signal), [path, id]);
  const state = useResource(load);
  return <div className="history-selection">
    <Resource label="content version" state={state}>{row => <>
      <h3>Version {row.version} · {row.content.title}</h3>
      <p className="muted">Stored <Timestamp value={row.created_at} /> UTC</p>
      <Content version={row} />
    </>}</Resource>
  </div>;
}

function SelectedObservation({ path, id, requestId, sourceId, selectVersion }: {
  path: string; id: string; requestId: string; sourceId: string; selectVersion: (id: string, trigger: HTMLElement) => void;
}) {
  const load = useCallback((signal: AbortSignal) => apiGet<ObservationDetail>(`${path}/observations/${id}`, signal), [path, id]);
  const state = useResource(load);
  return <div className="history-selection">
    <Resource label="observation payload" state={state}>{row =>
      requestId && !sameId(row.request_id, requestId)
        ? <p role="status">This observation belongs to a different collection. Select an observation from this request.</p>
        : <>
          <h3>Selected observation</h3>
          <p className="muted">Captured <Timestamp value={row.captured_at} /> UTC</p>
          <Lineage item={row} sourceId={sourceId} prefix="selected" />
          <button id="observation-content-version" type="button" onClick={event => selectVersion(
            row.content_version_id, event.currentTarget,
          )}>View observed version</button>
          <JsonViewer key={row.record_id} value={row.raw_payload} title="Extracted payload" />
        </>
    }</Resource>
  </div>;
}

function Content({ version }: { version: ArticleVersion }) {
  const { content } = version;
  return <div className="history-content">
    {(content.author || content.published_at) && <p>
      {content.author}{content.author && content.published_at && ' · '}
      {content.published_at && <>Published <Timestamp value={content.published_at} /> UTC</>}
    </p>}
    {content.summary && <p>{content.summary}</p>}
    {content.body && <details><summary>Article body</summary><p>{content.body}</p></details>}
  </div>;
}

function Lineage({ item, sourceId, prefix }: { item: Observation; sourceId: string; prefix: string }) {
  return <div className="history-lineage" aria-label="Observation lineage">
    <ContextLink id={prefix + '-article-record'} to={recordPath(item.record_id)}>Record</ContextLink>
    <ContextLink id={prefix + '-article-evidence'} to={evidenceDetailPath(item.evidence_id, item.request_id)}>Evidence</ContextLink>
    <Link to={jobPath(item.job_id)}>Job</Link>
    <Link to={sourcePath(sourceId)}>Source</Link>
    <Link to={profilePath(sourceId, item.profile_version_id)}>Profile version</Link>
    {item.request_id && <Link to={requestPath(item.request_id)}>Collection request</Link>}
  </div>;
}
