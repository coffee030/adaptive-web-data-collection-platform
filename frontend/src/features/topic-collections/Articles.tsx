import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { TableRegion, Timestamp } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath } from '../collection-jobs/api';
import { profilePath } from '../profiles/api';
import { evidenceDetailPath, recordPath, recordsPath } from '../results/api';
import { JsonViewer } from '../results/JsonViewer';
import { sourcePath } from '../sources/api';
import {
  articlePath, articlesPath, requestPath, type ArticleDetail, type ArticleSummary,
  type ArticleVersion, type Observation, type ObservationDetail, type VersionInfo,
} from './api';
import { Page, Resource } from './support';
import './topic-collections.css';

export function ArticlesPage() {
  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={recordsPath}>Data Explorer</Link></nav>
    <div className="page-heading"><h1>Articles</h1></div>
    <ArticleList />
  </>;
}

export function ArticleList({ requestId, revision }: { requestId?: string; revision?: number }) {
  return <section className="panel detail-panel" aria-label={requestId ? 'Articles observed by this request' : 'Latest articles'}>
    {requestId && <div className="panel-heading"><h2>Articles observed in this run</h2></div>}
    {requestId && <p className="notice muted">
      This request determines which articles appear. Titles, versions, and observation times show the latest capture across all collections.
    </p>}
    <Page<ArticleSummary> path={articlesPath} label="Articles" requestId={requestId} revision={revision}
      empty={requestId ? 'No articles have been observed in this run.' : 'Articles appear after a job publishes data from a profile with article mapping.'}>
      {rows => <TableRegion label="Latest article content">
        <table>
          <thead><tr><th scope="col">Latest title</th><th scope="col">Source</th>
            <th scope="col">Current version</th><th scope="col">Latest observation (UTC)</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <th scope="row"><Link to={articlePath(row.id)}>{row.title}</Link></th>
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
  const path = articlePath(id);
  const load = useCallback((signal: AbortSignal) => apiGet<ArticleDetail>(path, signal), [path]);
  const state = useResource(load);
  const [versionId, setVersion] = useState('');
  const [recordId, setRecord] = useState('');
  const loadVersion = useCallback((signal: AbortSignal) =>
    apiGet<ArticleVersion>(`${path}/versions/${versionId}`, signal), [path, versionId]);
  const loadObservation = useCallback((signal: AbortSignal) =>
    apiGet<ObservationDetail>(`${path}/observations/${recordId}`, signal), [path, recordId]);
  const version = useResource(loadVersion, 0, false, !!versionId);
  const observation = useResource(loadObservation, 0, false, !!recordId);

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={articlesPath}>Articles</Link></nav>
    <Resource label="article" state={state}>{article => <>
      <div className="page-heading collection-text"><h1>{article.title}</h1>
        <p><Link to={sourcePath(article.source_id)}>{article.source_name}</Link></p>
      </div>
      <section className="panel detail-panel" aria-labelledby="latest-article">
        <div className="panel-heading"><h2 id="latest-article">Latest content</h2></div>
        <div className="profile-body profile-form collection-text">
          <p>Version {article.version} · Observed <Timestamp value={article.captured_at} /> UTC</p>
          <p className="identifier"><a href={article.url} target="_blank" rel="noreferrer">{article.url}</a></p>
          <Content version={article.latest_version} />
          <Lineage item={article.latest_observation} sourceId={article.source_id} />
        </div>
      </section>
      <section className="panel detail-panel" aria-labelledby="article-versions">
        <div className="panel-heading"><h2 id="article-versions">Content versions</h2></div>
        <Page<VersionInfo> path={path + '/versions'} label="Versions" empty="No content versions.">
          {rows => <TableRegion label="Content versions">
            <table><thead><tr><th scope="col">Version</th><th scope="col">Stored (UTC)</th>
              <th scope="col">Content</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id}>
                <th scope="row">Version {row.version}</th><td><Timestamp value={row.created_at} /></td>
                <td><button type="button"
                  aria-pressed={versionId === row.id} onClick={() => setVersion(versionId === row.id ? '' : row.id)}>
                  View version {row.version}
                </button></td>
              </tr>)}</tbody>
            </table>
          </TableRegion>}
        </Page>
        {versionId && <div className="profile-body collection-text">
          <Resource label="content version" state={version}>{row => <>
            <h3>Version {row.version} · {row.content.title}</h3><Content version={row} />
          </>}</Resource>
        </div>}
      </section>
      <section className="panel detail-panel" aria-labelledby="article-observations">
        <div className="panel-heading"><h2 id="article-observations">Observation history</h2></div>
        <Page<Observation> path={path + '/observations'} label="Observations" empty="No observations.">
          {rows => <TableRegion label="Observation history">
            <table><thead><tr><th scope="col">Observed (UTC)</th><th scope="col">Lineage</th>
              <th scope="col">Payload</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={row.record_id}>
                <th scope="row"><Timestamp value={row.captured_at} /></th>
                <td><Lineage item={row} sourceId={article.source_id} /></td>
                <td><button type="button" aria-label={`View extracted payload for observation ${index + 1} on this page`}
                  aria-pressed={recordId === row.record_id} onClick={() => setRecord(recordId === row.record_id ? '' : row.record_id)}>
                  View extracted payload
                </button></td>
              </tr>)}</tbody>
            </table>
          </TableRegion>}
        </Page>
      </section>
      {recordId && <Resource label="observation payload" state={observation}>{row =>
        <JsonViewer key={row.record_id} value={row.raw_payload} title="Extracted payload" />
      }</Resource>}
    </>}</Resource>
  </>;
}

function Content({ version }: { version: ArticleVersion }) {
  const { content } = version;
  return <>
    {(content.author || content.published_at) && <p>
      {content.author}{content.author && content.published_at && ' · '}
      {content.published_at && <>Published <Timestamp value={content.published_at} /> UTC</>}
    </p>}
    {content.summary && <div><strong>Summary</strong><p>{content.summary}</p></div>}
    {content.body && <div><strong>Body</strong><p>{content.body}</p></div>}
  </>;
}

function Lineage({ item, sourceId }: { item: Observation; sourceId: string }) {
  return <div className="profile-actions">
    <Link to={jobPath(item.job_id)}>Job</Link>
    <Link to={recordPath(item.record_id)}>Record</Link>
    <Link to={evidenceDetailPath(item.evidence_id)}>Evidence</Link>
    <Link to={profilePath(sourceId, item.profile_version_id)}>Profile</Link>
    {item.request_id && <Link to={requestPath(item.request_id)}>Request</Link>}
  </div>;
}
