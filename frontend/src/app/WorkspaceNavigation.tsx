import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { jobsPath, newJobPath } from '../features/collection-jobs/api';
import { articlesPath, newRequestPath, requestsPath, topicsPath } from '../features/topic-collections/api';
import { evidencePath, recordsPath } from '../features/results/api';
import { sourcesPath } from '../features/sources/api';

import { datasetsPath, operationsPath, researchPath } from '../features/operator/OperationsTasks';

export function WorkspaceNavigation() {
  const { pathname, key } = useLocation();
  const [openFor, setOpenFor] = useState<string>();
  const open = openFor === key;
  const operationsCurrent = [sourcesPath, topicsPath, jobsPath, researchPath, datasetsPath].some(path =>
    pathname === path || pathname.startsWith(path + '/'),
  );
  const resultsContext = [articlesPath, evidencePath].some(path =>
    pathname === path || pathname.startsWith(path + '/'),
  );

  return <nav className="workspace-navigation" aria-label="Main navigation">
    <div className="nav-workspace">
      <p className="nav-group-label">Workspace</p>
      <div className="nav-links">
        <NavLink to={pathname === "/" && __PLATFORM_SYNTHETIC_DEMO__ ? "/" : operationsPath} end>Overview</NavLink>
        <NavLink to={newRequestPath} end>New Collection</NavLink>
        <NavLink to={requestsPath} end={pathname === newRequestPath}>Collection requests</NavLink>
        {resultsContext
          ? <Link to={recordsPath} aria-current="location">Data Explorer</Link>
          : <NavLink to={recordsPath}>Data Explorer</NavLink>}
      </div>
    </div>
    <div className="nav-operations" data-open={open} onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return;
      event.currentTarget.querySelector('button')?.focus();
      setOpenFor(undefined);
      event.preventDefault();
    }}>
      <p className="nav-group-label">Sources and collection</p>
      <button className="operations-toggle" type="button" aria-controls="operations-links"
        aria-expanded={open} data-current={operationsCurrent}
        onClick={() => setOpenFor(open ? undefined : key)}>
        Operations <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <div className="nav-links" id="operations-links" onClick={() => setOpenFor(undefined)}>
        <NavLink to={sourcesPath}>Sources</NavLink>
        <NavLink to={topicsPath}>Topics &amp; bindings</NavLink>
        <NavLink to={jobsPath} end={pathname === newJobPath}>Collection Jobs</NavLink>
        <NavLink to={newJobPath} end className="nav-secondary">Single-source &amp; CSV</NavLink>
        <NavLink to={researchPath} className="nav-secondary">Creator research</NavLink>
        <NavLink to={datasetsPath} className="nav-secondary">Intelligence datasets</NavLink>
      </div>
    </div>
  </nav>;
}
