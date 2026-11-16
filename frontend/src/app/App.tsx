import { useEffect, useRef } from 'react';
import { Link, Route, Routes, ScrollRestoration, useLocation } from 'react-router';
import { jobsPath, newJobPath } from '../features/collection-jobs/api';
import { Overview } from '../features/dashboard/Overview';
import { ThemeSelect } from './ThemeSelect';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { JobCreate } from '../features/collection-jobs/JobCreate';
import { JobDetail } from '../features/collection-jobs/JobDetail';
import { JobList } from '../features/collection-jobs/JobList';
import { sourcesPath } from '../features/sources/api';
import { SourceList } from '../features/sources/SourceList';
import { SourceCreate } from '../features/sources/SourceCreate';
import { SourceDetail } from '../features/sources/SourceDetail';
import { ProfilePage } from '../features/profiles/ProfilePage';
import { evidencePath, recordsPath } from '../features/results/api';
import { RecordsExplorer } from '../features/results/RecordsExplorer';
import { RecordDetail } from '../features/results/RecordDetail';
import { QuarantinePage } from '../features/results/QuarantinePage';
import { EvidenceDetail } from '../features/results/EvidenceDetail';
import { ArticlePage, ArticlesPage } from '../features/topic-collections/Articles';
import { NewTopicRequest, RequestDetails, RequestList } from '../features/topic-collections/Requests';
import { TopicBindings, TopicCatalog } from '../features/topic-collections/TopicCatalog';
import { articlesPath, newRequestPath, requestsPath, topicsPath } from '../features/topic-collections/api';

export function App() {
  const { pathname, hash } = useLocation();
  const lastPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const title = pathname === '/' ? 'Overview'
      : pathname === jobsPath ? 'Collection Jobs'
      : pathname === newJobPath ? 'Single-source collection and CSV import'
      : pathname === newRequestPath ? 'Collect by topic'
      : pathname.startsWith(requestsPath) ? 'Collection requests'
      : pathname.startsWith(topicsPath) ? 'Categories and topics'
      : pathname.startsWith(articlesPath) ? 'Articles'
      : pathname.startsWith(`${jobsPath}/`) && pathname.endsWith('/quarantine') ? 'Quarantine'
      : pathname.startsWith(`${jobsPath}/`) ? 'Job Details'
      : pathname === recordsPath ? 'Data Explorer'
      : pathname.startsWith(`${recordsPath}/`) ? 'Record Details'
      : pathname.startsWith(`${evidencePath}/`) ? 'Evidence Metadata'
      : pathname === sourcesPath ? 'Sources'
      : pathname === sourcesPath + '/new' ? 'Create Source'
      : pathname.includes('/profiles/') ? 'Profile Workspace'
      : pathname.startsWith(`${sourcesPath}/`) ? 'Source Details' : 'Data Operations';
    document.title = `${title} | Adaptive Web Data Collection Platform`;

    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      if (!hash) main.current?.focus({ preventScroll: true });
    }
  }, [pathname, hash]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content" onClick={event => {
        event.preventDefault();
        main.current?.focus();
      }}>Skip to main content</a>
      <ScrollRestoration />
      <header className="topbar">
        <Link className="wordmark" to="/">Data Collection Platform</Link>
        <ThemeSelect />
      </header>
      <WorkspaceNavigation />
      <main className="workspace" id="main-content" tabIndex={-1} ref={main}>
        <div className="workspace-inner">
          {__PLATFORM_SYNTHETIC_DEMO__ && (
            <p className="demo-notice">
              <strong>Synthetic Demo.</strong> Fictional data and prices.{' '}
              <Link to={requestsPath}>View collection requests</Link>
            </p>
          )}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path={jobsPath} element={<JobList />} />
            <Route path={newJobPath} element={<JobCreate />} />
            <Route path={requestsPath} element={<RequestList />} />
            <Route path={newRequestPath} element={<NewTopicRequest />} />
            <Route path={requestsPath + '/:requestId'} element={<RequestDetails />} />
            <Route path={topicsPath} element={<TopicCatalog />} />
            <Route path={topicsPath + '/:topicId'} element={<TopicBindings />} />
            <Route path={articlesPath} element={<ArticlesPage />} />
            <Route path={articlesPath + '/:articleId'} element={<ArticlePage />} />
            <Route path={`${jobsPath}/:jobId`} element={<JobDetail />} />
            <Route path={`${jobsPath}/:jobId/quarantine`} element={<QuarantinePage />} />
            <Route path={recordsPath} element={<RecordsExplorer />} />
            <Route path={`${recordsPath}/:recordId`} element={<RecordDetail />} />
            <Route path={`${evidencePath}/:evidenceId`} element={<EvidenceDetail />} />
            <Route path={sourcesPath} element={<SourceList />} />
            <Route path={sourcesPath + '/new'} element={<SourceCreate />} />
            <Route path={sourcesPath + '/:sourceId'} element={<SourceDetail />} />
            <Route path={sourcesPath + '/:sourceId/profiles/new'} element={<ProfilePage />} />
            <Route path={sourcesPath + '/:sourceId/profiles/:profileId'} element={<ProfilePage />} />
            <Route path="*" element={
              <>
                <h1>Page not found</h1>
                <Link to={jobsPath}>Go to Collection Jobs</Link>
              </>
            } />
          </Routes>
        </div>
      </main>
    </div>
  );
}
