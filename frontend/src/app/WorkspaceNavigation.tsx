import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { jobsPath, newJobPath } from '../features/collection-jobs/api';
import { articlesPath, newRequestPath, requestsPath, topicsPath } from '../features/topic-collections/api';
import { evidencePath, recordsPath } from '../features/results/api';
import { sourcesPath } from '../features/sources/api';
import { datasetsPath, directoryPath, marketSourcesPath, operationsPath, researchPath } from '../features/operator/OperationsTasks';

export function WorkspaceNavigation() {
  const { pathname, key } = useLocation();
  const [openFor,setOpenFor] = useState<string>();
  const open = openFor === key;
  const inSection = (path: string) => pathname === path || pathname.startsWith(path + '/');
  const operationsCurrent = [sourcesPath,topicsPath,jobsPath,researchPath,datasetsPath,directoryPath,marketSourcesPath,'/operations/companies'].some(inSection);
  const resultsContext = [articlesPath,evidencePath].some(inSection);
  return <nav className="ops-navigation" aria-label="Main navigation">
    <div className="ops-links-section"><p>Collection workspace</p>
      <div className="ops-nav-links">
        <NavLink to={pathname === '/' && __PLATFORM_SYNTHETIC_DEMO__ ? '/' : operationsPath} end>Overview</NavLink>
        <NavLink to={newRequestPath} end>New Collection</NavLink>
        <NavLink to={requestsPath} end={pathname === newRequestPath}>Collection requests</NavLink>
        {resultsContext ? <Link aria-current="location" to={recordsPath}>Data Explorer</Link> : <NavLink to={recordsPath}>Data Explorer</NavLink>}
      </div>
    </div>
    <div className="ops-admin" data-open={open} onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return;
      event.currentTarget.querySelector('button')?.focus(); setOpenFor(undefined); event.preventDefault();
    }}>
      <button type="button" className="ops-nav-toggle" aria-controls="ops-admin-links" aria-expanded={open} data-current={operationsCurrent}
        onClick={() => setOpenFor(open ? undefined : key)}>Operations <span aria-hidden="true">{open ? '−' : '+'}</span></button>
      <div id="ops-admin-links" onClick={() => setOpenFor(undefined)}>
        <div className="ops-links-section"><p>Collection control</p><div className="ops-nav-links">
          <NavLink to={sourcesPath}>Sources</NavLink><NavLink to={topicsPath}>Topics &amp; bindings</NavLink>
          <NavLink to={jobsPath} end={pathname === newJobPath}>Collection Jobs</NavLink><NavLink to={newJobPath} end>Single-source &amp; CSV</NavLink>
        </div></div>
        <div className="ops-links-section"><p>Marketing publication</p><div className="ops-nav-links">
          <NavLink to={marketSourcesPath}>Market sources</NavLink><NavLink to={directoryPath}>Public research sources</NavLink>
          <NavLink to={researchPath}>Creator research</NavLink><NavLink to={datasetsPath}>Intelligence datasets</NavLink>
          {__HARBOURLINE_INSTALLATION__ === 'pilot' && <NavLink to="/operations/companies">Company setup</NavLink>}
        </div></div>
      </div>
    </div>
  </nav>;
}
