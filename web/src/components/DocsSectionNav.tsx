import React from 'react';
import clsx from 'clsx';
import { Link, useLocation } from 'react-router-dom';

export type DocsNavItem = {
  label: string;
  path: string;
  /** Material Symbols Outlined ligature */
  icon: string;
};

export const DOCS_NAV_ITEMS: DocsNavItem[] = [
  { label: 'Docs Home', path: '/docs', icon: 'info' },
  { label: 'Architecture', path: '/docs/architecture', icon: 'rocket_launch' },
  { label: 'Data Feeds', path: '/docs/data', icon: 'database' },
  { label: 'Scores', path: '/docs/scores', icon: 'query_stats' },
  { label: 'Signals', path: '/docs/signals', icon: 'verified_user' },
  { label: 'Signal Builder', path: '/docs/signal-builder', icon: 'construction' },
];

const DocsSectionNav: React.FC = () => {
  const location = useLocation();

  return (
    <nav className="flex flex-col space-y-1 font-body text-sm font-medium tracking-wide">
      <div className="mb-6 px-2">
        <h3 className="font-headline text-lg font-black text-primary">Technical Guides</h3>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Model reference</p>
      </div>
      {DOCS_NAV_ITEMS.map((item) => {
        const active = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={clsx(
              'flex items-center gap-3 rounded-md px-3 py-2 transition-colors duration-150',
              active
                ? 'bg-surface-container font-semibold text-primary'
                : 'text-slate-400 hover:bg-surface-container hover:text-slate-200',
            )}
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={active ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined}
              aria-hidden
            >
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};

export default DocsSectionNav;
