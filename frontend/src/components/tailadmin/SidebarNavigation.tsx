import type { ComponentType, ReactNode, SVGProps } from 'react';
import { NavLink } from 'react-router';

export interface MenuItem {to:string; name:string; compact:string; icon:ComponentType<SVGProps<SVGSVGElement>>}
export interface MenuGroup {label:string;items:MenuItem[]}

export function SidebarNavigation({groups,brand,footer}:{groups:MenuGroup[];brand:ReactNode;footer:ReactNode}) {
  return <aside data-slot="sidebar" className="hl-sidebar">
    <div data-sidebar="header" className="hl-sidebar-brand">{brand}</div>
    <nav data-sidebar="content" aria-label="Marketing workspace">{groups.map(group=><div data-sidebar="group" key={group.label}>
      <p data-sidebar="group-label">{group.label}</p><ul data-sidebar="menu">{group.items.map(item=><li key={item.name} data-sidebar="menu-item">
        <NavLink end to={item.to} aria-label={item.name} className={({isActive})=>'menu-item '+(isActive?'menu-item-active':'menu-item-inactive')}>
          <span className="menu-item-icon"><item.icon aria-hidden="true"/></span><span className="menu-item-text">{item.name}</span><span className="hl-mobile-item">{item.compact}</span>
        </NavLink></li>)}</ul></div>)}</nav>
    <div data-sidebar="footer" className="hl-sidebar-footer">{footer}</div>
  </aside>;
}