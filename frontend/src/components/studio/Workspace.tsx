import { useId, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import './tabler.css';
import './workspace.css';

interface HeadingProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: HeadingProps) {
  return <header className="studio-page-header">
    <div><h1 className="studio-page-title">{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="studio-actions">{actions}</div>}
  </header>;
}

export function Panel({ title, description, actions, children, className = '' }: HeadingProps & {
  children: ReactNode; className?: string;
}) {
  const heading = useId();
  return <section className={'studio-panel ' + className} aria-labelledby={heading}>
    <header className="studio-panel-head">
      <div><h2 className="studio-panel-title" id={heading}>{title}</h2>{description && <p>{description}</p>}</div>
      {actions && <div className="studio-panel-actions">{actions}</div>}
    </header>
    {children}
  </section>;
}

export function MetricStrip({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return <dl className="studio-metrics">{items.map(({ label, value, note }) =>
    <div className="studio-metric" key={label}>
      <dt className="studio-metric-label">{label}</dt>
      <dd className="studio-metric-value">{value}</dd>
      {note && <dd className="studio-metric-note">{note}</dd>}
    </div>)}</dl>;
}

export interface NavigationItem {
  to: string;
  name: string;
  icon?: ReactNode;
  end?: boolean;
}

export function WorkspaceNav({ label, brand, groups, footer }: {
  label: string; brand: ReactNode; groups: { label: string; items: NavigationItem[] }[]; footer?: ReactNode;
}) {
  const groupId = useId();
  const location = useLocation();
  const [openFor, setOpenFor] = useState('');
  const open = openFor === location.key;
  return <nav aria-label={label} className="studio-workspace-nav" data-open={open}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return;
      event.currentTarget.querySelector<HTMLButtonElement>('.studio-mobile-nav-trigger')?.focus();
      setOpenFor('');
    }}>
    <div className="studio-nav-brand">{brand}<button className="studio-mobile-nav-trigger" type="button"
      aria-expanded={open} aria-controls={groupId} onClick={() => setOpenFor(open ? '' : location.key)}>Menu</button></div>
    <div className="studio-nav-groups" id={groupId}>{groups.map(group =>
      <div className="studio-nav-group" key={group.label}><p>{group.label}</p>
        <ul className="studio-nav-list">{group.items.map(item =>
          <li className="studio-nav-item" key={item.to}><NavLink className="studio-nav-link" end={item.end ?? true}
            to={item.to} onClick={() => setOpenFor('')}>{item.icon}{item.name}</NavLink></li>)}</ul>
      </div>)}</div>
    {footer && <div className="studio-nav-footer">{footer}</div>}
  </nav>;
}
