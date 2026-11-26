import type { ReactNode, RefObject } from 'react';
import { Link, ScrollRestoration } from 'react-router';
import { ThemeSelect } from '../../app/ThemeSelect';
import { WorkspaceNavigation } from '../../app/WorkspaceNavigation';
import { lockOperator } from '../../lib/api';
import { requestsPath } from '../topic-collections/api';
import { operationsPath } from './OperationsTasks';
import '../../components/studio/tabler.css';
import '../../components/studio/workspace.css';
import './frame.css';

export function OperationsFrame({ children, mainRef }: { children: ReactNode; mainRef: RefObject<HTMLElement | null> }) {
  return <div className="studio ops-frame" data-workspace="operations">
    <ScrollRestoration/>
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault(); mainRef.current?.focus();
    }}>Skip to main content</a>
    <header className="ops-topbar">
      <Link className="ops-brand" to={operationsPath} aria-label="Harbourline Scraping Operations">
        <svg width="34" height="34" viewBox="0 0 38 38" fill="none" aria-hidden="true"><rect x="1" y="1" width="36" height="36" rx="8" stroke="currentColor"/>
          <path d="M7 26h5l5-13 5 8 3-5 6 10M9 30h20" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/></svg>
        <span>Harbourline<small>Scraping Operations</small></span>
      </Link>
      <div className="ops-utilities"><Link to={__PLATFORM_SYNTHETIC_DEMO__ ? '/demo/connected' : '/'}>Return to Harbourline</Link>
        {__HARBOURLINE_INSTALLATION__ === 'pilot' && <button type="button" onClick={lockOperator}>Lock Data Operations</button>}
        <ThemeSelect/></div>
    </header>
    <WorkspaceNavigation/>
    <main id="main-content" ref={mainRef} tabIndex={-1} className="workspace ops-main"><div className="workspace-inner">
      {__PLATFORM_SYNTHETIC_DEMO__ && <p className="demo-notice"><strong>Synthetic Demo.</strong> Fictional data and prices. <Link to={requestsPath}>View collection requests</Link></p>}
      {children}
    </div></main>
  </div>;
}
