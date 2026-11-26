import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { jobsPath, newJobPath } from '../features/collection-jobs/api';
import { Overview } from '../features/dashboard/Overview';
import { OperationsFrame } from '../features/operator/OperationsFrame';
import { JobCreate } from '../features/collection-jobs/JobCreate';
import { JobDetail } from '../features/collection-jobs/JobDetail';
import { JobList } from '../features/collection-jobs/JobList';
import { sourcesPath } from '../features/sources/api';
import { SourceList } from '../features/sources/SourceList';
import { SourceCreate } from '../features/sources/SourceCreate';
import { SourceDetail } from '../features/sources/SourceDetail';
import { Loading } from '../components/feedback';
import { evidencePath, recordsPath } from '../features/results/api';
import { RecordsExplorer } from '../features/results/RecordsExplorer';
import { RecordDetail } from '../features/results/RecordDetail';
import { QuarantinePage } from '../features/results/QuarantinePage';
import { EvidenceDetail } from '../features/results/EvidenceDetail';
import { ArticlePage, ArticlesPage } from '../features/topic-collections/Articles';
import { RequestDetails, RequestList } from '../features/topic-collections/Requests';
import { NewTopicRequest } from '../features/topic-collections/NewTopicRequest';
import { articlesPath, newRequestPath, requestsPath, topicsPath } from '../features/topic-collections/api';

import { datasetsPath, directoryPath, marketSourcesPath, operationsPath, researchPath } from '../features/operator/OperationsTasks';

const OperatorGate = lazy(async () => ({ default: (await import('../features/operator/OperatorGate')).OperatorGate }));
const CompanySetup = lazy(async () => ({ default: (await import('../features/operator/CompanyRegistry')).CompanySetup }));
const MarketingWorkspace = lazy(async () => ({ default: (await import('../features/marketing/MarketingWorkspace')).MarketingWorkspace }));
const IntelligenceDatasets = lazy(async () => ({ default: (await import('../features/operator/IntelligenceDatasets')).IntelligenceDatasets }));
const MarketSources = lazy(async () => ({ default: (await import('../features/operator/MarketSources')).MarketSources }));
const PublicDirectoryOperations = lazy(async () => ({ default: (await import('../features/operator/PublicResearchSources')).PublicDirectoryOperations }));
const CreatorResearch = lazy(async () => ({ default: (await import('../features/operator/CreatorResearch')).CreatorResearch }));
const operatorPrefixes = [operationsPath, jobsPath, requestsPath, topicsPath, articlesPath, recordsPath, evidencePath, sourcesPath];
const ProfilePage = lazy(async () => ({ default: (await import('../features/profiles/ProfilePage')).ProfilePage }));
const TopicCatalog = lazy(async () => ({ default: (await import('../features/topic-collections/TopicCatalog')).TopicCatalog }));
const TopicBindings = lazy(async () => ({ default: (await import('../features/topic-collections/TopicBindings')).TopicBindings }));

function operatorRoute(page: ReactNode) {
  return <Suspense fallback={<Loading>Loading operator workspace…</Loading>}>{page}</Suspense>;
}

export function App() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';
  const demo = path === '/demo' || path.startsWith('/demo/');
  const operations = operatorPrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'));
  if (demo || (!operations && !(path === '/' && __PLATFORM_SYNTHETIC_DEMO__))) {
    return <Suspense fallback={<Loading>Loading campaign workspace…</Loading>}><MarketingWorkspace mode={path === '/demo/connected' || path.startsWith('/demo/connected/') ? 'server-demo' : demo ? 'sample' : 'partner'} /></Suspense>;
  }
  return __HARBOURLINE_INSTALLATION__ === 'pilot'
    ? operatorRoute(<OperatorGate><OperationsApp /></OperatorGate>) : <OperationsApp />;
}

function OperationsApp() {
  const { pathname, hash } = useLocation();
  const lastPath = useRef(pathname);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const title = pathname === '/' || pathname === operationsPath ? 'Data Operations'
      : pathname === '/operations/companies' ? 'Company setup'
      : pathname === marketSourcesPath ? 'Market sources'
      : pathname === directoryPath ? 'Public research sources'
      : pathname === researchPath ? 'Creator research and refresh'
      : pathname === datasetsPath ? 'Intelligence datasets'
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
    <OperationsFrame mainRef={main}>
          <Routes>
            {__PLATFORM_SYNTHETIC_DEMO__ && <Route path="/" element={<Overview />} />}
            <Route path={operationsPath} element={<Overview />} />
            <Route path="/operations/companies" element={operatorRoute(<CompanySetup />)} />
            <Route path={datasetsPath} element={operatorRoute(<IntelligenceDatasets />)} />
            <Route path={marketSourcesPath} element={operatorRoute(<MarketSources />)} />
            <Route path={directoryPath} element={operatorRoute(<PublicDirectoryOperations />)} />
            <Route path={researchPath} element={operatorRoute(<CreatorResearch />)} />
            <Route path={jobsPath} element={<JobList />} />
            <Route path={newJobPath} element={<JobCreate />} />
            <Route path={requestsPath} element={<RequestList />} />
            <Route path={newRequestPath} element={<NewTopicRequest />} />
            <Route path={requestsPath + '/:requestId'} element={<RequestDetails />} />
            <Route path={topicsPath} element={operatorRoute(<TopicCatalog />)} />
            <Route path={topicsPath + '/:topicId'} element={operatorRoute(<TopicBindings />)} />
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
            <Route path={sourcesPath + '/:sourceId/profiles/new'} element={operatorRoute(<ProfilePage />)} />
            <Route path={sourcesPath + '/:sourceId/profiles/:profileId'} element={operatorRoute(<ProfilePage />)} />
            <Route path="*" element={
              <>
                <h1>Page not found</h1>
                <Link to={jobsPath}>Go to Collection Jobs</Link>
              </>
            } />
          </Routes>
    </OperationsFrame>
  );
}
